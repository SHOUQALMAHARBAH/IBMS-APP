import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  Customer,
  RiskLevel,
  ScreeningOutcome,
  ScreeningResult,
} from '@ibms/db';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import { AuditService } from '../audit/audit.service';
import {
  matchesSampleWatchlist,
  sampleWatchlistEnabled,
} from './sample-watchlist';
import {
  canonicalNameTokens,
  classifyMatch,
  type WatchlistMatchType,
} from '../compliance-risk/watchlist-match.config';
import { ScreeningMatchRepository } from '../../repositories/screening-match.repository';
import { normalizeWatchlistName } from '../compliance-risk/watchlist-sync.config';
import { SlaTimerService } from '../sla/sla-timer.service';

/** Registry workflow for adjudicating a queued sanctions match. */
const SANCTIONS_MATCH_REVIEW_WORKFLOW = 'sanctions_match_review';

const SCREENING_TYPES = ['SANCTIONS', 'PEP', 'AML'] as const;

interface WatchlistHit {
  listSource: string;
  /** How the real-list candidate was found. Absent for a fixture hit, which
   * is a literal substring match and has no canonical-token notion. */
  matchType?: WatchlistMatchType;
}

export interface ScreeningRunResult {
  results: ScreeningResult[];
  riskLevel: RiskLevel;
  isEdd: boolean;
  /** True when THIS run produced at least one HIT — distinct from `isEdd`
   * (the record's flag, which only ever escalates and is never cleared by a
   * later CLEAR re-scan). Used by the recurring batch for its hit counter. */
  newHit: boolean;
  /** How many real-list entries were queued for review by this run. */
  matchCandidates: number;
  /** False when NO populated list could be consulted, so `results` are
   * PENDING_INVESTIGATION rather than CLEAR. */
  screenable: boolean;
  /** True when candidates for at least one subject name hit the per-name cap,
   * so the review queue for this KYC file is INCOMPLETE. Surfaced rather than
   * swallowed: a reviewer working a truncated queue has no other way to know
   * that evidence was dropped. */
  matchesTruncated: boolean;
}

export interface ScreeningBatchResult {
  screened: number;
  hits: number;
  failed: number;
  /** Processed without error, matched nothing — but consulted no populated
   * list, so the result is PENDING_INVESTIGATION rather than CLEAR. */
  unscreenable: number;
}

const ACTIVE_CUSTOMER_RESCREEN_STATUSES = [
  'APPROVED',
  'PERIODIC_REVIEW_DUE',
] as const;

/** Process 3.1/47/49 — sanctions/PEP/AML screening. Checks the Customer's
 * `legalName` and every UBO's `fullName` on the same KYCRecord's Customer
 * against TWO sources: `sample-watchlist.ts` (a fictional, dev/test-only
 * fixture, disabled in production — see that file's header) and the real,
 * synced `WatchlistEntry` cache (Process 49 — two free public sanctions
 * lists, OFAC SDN + UN Consolidated, kept current by `WatchlistSyncService`
 * every 12 hours; matched by `watchlist-match.config.ts` — exact on
 * `normalizeWatchlistName`'s form OR on the transliteration-collapsed
 * canonical token set, PLUS a fuzzy containment rule for entries of two or
 * more tokens. Every candidate is queued for human review; nothing here
 * blocks a customer. See `watchlist-match.config.ts` and
 * `ibms-brain/meta/context/sanctions-pep-screening.md`). The real check runs
 * in every environment, including production; the fixture never does. All
 * three `ScreeningType`s are checked against the same combined result here
 * (a real integration would call three distinct lists/providers per type);
 * this is a deliberate simplification, not a claim that sanctions/PEP/AML
 * are the same list. */
@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);

  constructor(
    private readonly kycRecords: KycRecordRepository,
    private readonly customers: CustomerRepository,
    private readonly watchlistEntries: WatchlistEntryRepository,
    private readonly screeningMatches: ScreeningMatchRepository,
    private readonly sla: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  async run(
    kycRecordId: string,
    actorUserId: string,
  ): Promise<ScreeningRunResult> {
    const kyc = await this.kycRecords.findById(kycRecordId);
    if (!kyc) throw new NotFoundException('KYCRecord not found');
    const customer = await this.customers.findById(kyc.customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const ubos = await this.customers.findUbosByCustomerId(kyc.customerId);

    const subjectNames = [customer.legalName, ...ubos.map((u) => u.fullName)];

    const results: ScreeningResult[] = [];
    const now = new Date();

    // subjectNames is fixed for this run, so the match result is identical
    // for every ScreeningType — compute it once rather than re-scanning the
    // same names 3 times for the same answer. The fixture (dev/test only)
    // and the real synced list are both checked; the fixture wins if both
    // somehow match (it never fires in production, so in practice at most
    // one of the two ever does).
    const fixtureHit = subjectNames
      .map((name) => matchesSampleWatchlist(name))
      .find((match) => match !== null);
    const real = await this.findRealWatchlistMatches(
      kycRecordId,
      subjectNames,
      actorUserId,
    );
    const { candidates: matchCandidates, truncated: matchesTruncated } = real;

    // Could this screening actually reach a populated list?
    //
    // A CLEAR must mean "we checked a list and this subject was not on it",
    // never "we checked an empty table". Those are indistinguishable to every
    // consumer of ScreeningResult, and the second is FALSE ASSURANCE on a
    // sanctions control — the same silent-CLEAR failure this module has now
    // been bitten by twice (the exact-matcher misses, and this).
    //
    // Not theoretical: `WatchlistEntry` is EMPTY on every deployment of this
    // system, because the sync has never been run anywhere. Every production
    // screening to date has returned CLEAR without consulting any list.
    //
    // The fixture counts as a populated source where it is enabled, because
    // there a real check against real data genuinely did happen. It is
    // disabled in production (`sampleWatchlistEnabled()`), so there the
    // synced cache is the only thing that can satisfy this.
    const realListUsable = await this.watchlistEntries.hasUsableEntries();
    const screenable = sampleWatchlistEnabled() || realListUsable;
    const hit: WatchlistHit | undefined = fixtureHit ?? real.hit ?? undefined;
    const anyHit = hit !== undefined;

    // A HIT is still a HIT — matching something proves a list was consulted.
    // Otherwise: CLEAR only if a populated source was actually searched,
    // PENDING_INVESTIGATION when nothing was. That enum value has existed
    // since the original schema with no writer anywhere in the codebase; this
    // is exactly the state it describes.
    const outcome: ScreeningOutcome = anyHit
      ? 'HIT'
      : screenable
        ? 'CLEAR'
        : 'PENDING_INVESTIGATION';

    if (!screenable) {
      this.logger.error(
        `Screening ${kycRecordId}: the sanctions cache is EMPTY, so no real list was consulted. Recording PENDING_INVESTIGATION rather than CLEAR. Run POST /watchlist-sync/run (or wait for WatchlistSyncScheduler) — until then no customer can be meaningfully screened.`,
      );
    }

    for (const screeningType of SCREENING_TYPES) {
      const result = await this.kycRecords.createScreeningResult({
        kycRecordId,
        screeningType,
        result: outcome,
        listSource: hit?.listSource,
        // An un-screenable file is escalated too: somebody has to notice that
        // this customer was never actually checked.
        escalatedToComplianceAt: anyHit || !screenable ? now : undefined,
      });
      results.push(result);

      await this.audit.record({
        userId: actorUserId,
        action: 'CREATE',
        entityType: 'ScreeningResult',
        entityId: result.id,
        afterValue: {
          kycRecordId,
          screeningType,
          result: result.result,
          // listSource identifies which fixture/provider list matched —
          // never the matched subject's own PII (sensitive-data-handling.md
          // "log identifiers instead").
          listSource: result.listSource,
        },
      });
    }

    // A re-screen (KycService.rerunScreening, or the 4-hourly
    // ScreeningBatchScheduler) must never silently DOWNGRADE a
    // classification: a CLEAR result on a later scan does not undo whatever
    // drove a prior HIT-based escalation — that call is a deliberate
    // Compliance decision, not an automatic side effect. So the level and
    // the isEdd flag only ever escalate here (a retained HIGH is a no-op,
    // handled below by not re-writing the row at all).
    const existingRating =
      await this.kycRecords.findRiskRatingByKycRecordId(kycRecordId);
    const riskLevel: RiskLevel =
      anyHit || existingRating?.level === 'HIGH' ? 'HIGH' : 'STANDARD';
    const ratingReason = anyHit
      ? 'Automatic: at least one sanctions/PEP/AML screening result was a HIT'
      : 'Automatic: all sanctions/PEP/AML screening results were CLEAR';

    // Only write the RiskRating when the classification actually changes
    // (first assessment, or an escalation) — and audit every such write.
    // `upsertRiskRating`'s update branch bumps `ratedAt` and rewrites
    // `reason` unconditionally, so calling it on a re-screen that keeps the
    // same level would silently mutate the row (a reviewer reads `ratedAt`
    // as "when this rating was last assessed") with nothing in the audit
    // trail. The per-run "we screened again and it was CLEAR" evidence is
    // the ScreeningResult rows above; RiskRating is the classification,
    // which only moves on escalation.
    if (!existingRating || existingRating.level !== riskLevel) {
      const rating = await this.kycRecords.upsertRiskRating({
        kycRecordId,
        level: riskLevel,
        reason: ratingReason,
      });
      await this.audit.record(
        existingRating
          ? {
              userId: actorUserId,
              action: 'UPDATE',
              entityType: 'RiskRating',
              entityId: rating.id,
              beforeValue: { level: existingRating.level },
              afterValue: { level: riskLevel, reason: ratingReason },
            }
          : {
              userId: actorUserId,
              action: 'CREATE',
              entityType: 'RiskRating',
              entityId: rating.id,
              afterValue: { kycRecordId, level: riskLevel },
            },
      );
    }

    // isEdd only ever goes false -> true (on a HIT); a subsequent CLEAR
    // re-scan never clears it.
    const currentIsEdd = kyc.isEdd ?? false;
    const nextIsEdd = currentIsEdd || anyHit;
    if (nextIsEdd !== currentIsEdd) {
      await this.kycRecords.update(kycRecordId, { isEdd: nextIsEdd });
      await this.audit.record({
        userId: actorUserId,
        action: 'UPDATE',
        entityType: 'KYCRecord',
        entityId: kycRecordId,
        beforeValue: { isEdd: currentIsEdd },
        afterValue: { isEdd: nextIsEdd },
      });
    }

    return {
      results,
      riskLevel,
      isEdd: nextIsEdd,
      newHit: anyHit,
      screenable,
      matchCandidates,
      matchesTruncated,
    };
  }

  /**
   * The real (non-fixture) watchlist check against the synced
   * `WatchlistEntry` cache. Runs in every environment, production included.
   *
   * Matching is exact OR containment (Process 49) — see
   * `WatchlistEntryRepository.findMatchCandidates` for the three ORed
   * branches. Containment ADDS to exact matching, it never replaces it: an
   * earlier version made containment the only rule and regressed every entry
   * below the fuzzy token floor to CLEAR. The pure exact-equality version
   * before that silently missed the two
   * commonest real shapes for this Jordan-based broker — a different
   * romanisation of the same Arabic name, and a four-part national-ID name
   * against a two/three-part list entry — and a missed sanctions match
   * surfaces as CLEAR, which is the worst failure mode this control has.
   *
   * Every candidate becomes a `ScreeningMatch` for a human to work, and the
   * screening result is a HIT so the existing HIGH-risk / EDD escalation
   * still fires. Nothing here blocks or suspends the customer: fuzzy
   * matching by construction produces false positives, so the decision is
   * explicitly a person's, not the system's.
   *
   * A name with no usable characters yields no tokens and is skipped rather
   * than queried — an empty token set is contained in nothing, but skipping
   * avoids a pointless round trip for every subject whose name is entirely
   * punctuation.
   */
  private async findRealWatchlistMatches(
    kycRecordId: string,
    subjectNames: readonly string[],
    actorUserId: string,
  ): Promise<{
    hit: WatchlistHit | undefined;
    candidates: number;
    truncated: boolean;
  }> {
    let hit: WatchlistHit | undefined;
    let candidates = 0;
    let truncated = false;

    for (const name of subjectNames) {
      const subjectTokens = canonicalNameTokens(name);
      const normalizedName = normalizeWatchlistName(name);
      if (subjectTokens.length === 0 && !normalizedName) continue;

      const found = await this.watchlistEntries.findMatchCandidates({
        subjectTokens,
        normalizedName,
      });

      if (found.truncated) {
        truncated = true;
        // A capped read is fine; a SILENT one is not. This is evidence a
        // human was supposed to adjudicate, so it is logged at error level
        // rather than dropped — the reviewer is seeing an incomplete queue
        // for this subject and nothing else would tell them.
        this.logger.error(
          `Screening ${kycRecordId}: watchlist candidates for one subject name hit the per-name cap; the review queue for this subject is INCOMPLETE — some candidate entries were not queued for review.`,
        );
      }

      for (const entry of found.entries) {
        const matchType = classifyMatch(name, entry.fullName);
        candidates += 1;

        // The `@@unique(kycRecordId, watchlistEntryId, subjectName)` is the
        // real guard, not a findFirst check: the 4-hourly recurring batch
        // re-screens every active customer, and without it each pass would
        // mint a duplicate queue item. A concurrent duplicate is a no-op.
        const recorded = await this.screeningMatches.recordCandidate({
          kycRecordId,
          watchlistEntryId: entry.id,
          subjectName: name,
          // What the match was actually made on, and what the duplicate
          // suppression keys on — the raw name would let a re-cased or
          // re-spaced legal name mint a second item past a cleared decision.
          subjectCanonical: subjectTokens.join(' '),
          matchType,
          // Snapshot: `pruneStale` deletes the entry when the subject is
          // de-listed, and a confirmed match has to outlive that.
          entrySource: entry.source,
          entrySourceRecordId: entry.sourceRecordId,
          entryFullName: entry.fullName,
          entryListProgram: entry.listProgram,
        });

        // A NEW pending item starts a tracked deadline. Fuzzy matching only
        // works as a control because a person adjudicates the output, and
        // without a deadline "a person decides" quietly becomes "a pending
        // row nobody owns". Only on creation: the 4-hourly batch re-screens
        // the same customer, and re-arming the timer each pass would mean the
        // item was never actually late.
        //
        // Best-effort, like KycService's own screening timer: the match is
        // already durably queued, and a missing timer must not turn a
        // successful screening run into a failure.
        if (recorded.created) {
          try {
            await this.sla.startTimer({
              entityType: 'ScreeningMatch',
              entityId: recorded.id,
              workflowName: SANCTIONS_MATCH_REVIEW_WORKFLOW,
              dueAt: await this.sla.computeDueAt(
                SANCTIONS_MATCH_REVIEW_WORKFLOW,
                new Date(),
              ),
              actorUserId,
            });
          } catch (err) {
            this.logger.error(
              `ScreeningMatch ${recorded.id}: queued, but its ${SANCTIONS_MATCH_REVIEW_WORKFLOW} SLA timer failed to start: ${(err as Error).message}`,
            );
          }
        }

        // First candidate wins for the ScreeningResult's own listSource; an
        // exact one is preferred over a fuzzy one so the headline result
        // names the strongest evidence.
        if (!hit || (matchType === 'exact' && hit.matchType !== 'exact')) {
          hit = {
            listSource: entry.listProgram
              ? `${entry.source} (${entry.listProgram})`
              : entry.source,
            matchType,
          };
        }
      }
    }

    return { hit, candidates, truncated };
  }

  /** Process 49 — "a recurring batch against updated lists" (backlog Part C
   * #49's checkbox). Shared by `ScreeningBatchScheduler` (4-hourly) and the
   * on-demand `POST /screening/recurring-batch`. Re-screens every ACTIVE
   * customer whose latest `KYCRecord` is `APPROVED` *or*
   * `PERIODIC_REVIEW_DUE` — the same customer-selection logic the scheduler
   * used inline before this method existed (moved here, unchanged, so the
   * on-demand endpoint gets the identical selection the schedule does).
   * Per-customer isolation: one customer's screening failure must not
   * abandon the rest of the batch (the #9/#12/#27/#46/#48 shape). A
   * batch-level failure (e.g. `findActive()` itself throwing) is NOT caught
   * here — it propagates to the caller, which for the scheduler means its
   * own try/catch, and for the on-demand endpoint means a 500, both the
   * established shape for a sweep-style method (`RetentionCaseService.
   * runSweep` / `TransactionMonitoringService.runSweep`). */
  async runRecurringBatch(actorUserId: string): Promise<ScreeningBatchResult> {
    const activeCustomers: Customer[] = await this.customers.findActive();

    let screened = 0;
    let hits = 0;
    let failed = 0;
    // Counted separately from `hits` and `failed`: these customers were
    // processed without error and matched nothing, but nothing was actually
    // checked. Reporting them inside `screened` alone would tell a Compliance
    // Officer "500 screened, 0 hits" about a run that consulted no list.
    let unscreenable = 0;
    for (const customer of activeCustomers) {
      try {
        const kyc = await this.kycRecords.findLatestByCustomerId(customer.id);
        if (
          !kyc ||
          !ACTIVE_CUSTOMER_RESCREEN_STATUSES.includes(
            kyc.status as (typeof ACTIVE_CUSTOMER_RESCREEN_STATUSES)[number],
          )
        ) {
          continue;
        }
        const { newHit, screenable } = await this.run(kyc.id, actorUserId);
        screened += 1;
        if (newHit) hits += 1;
        if (!screenable) unscreenable += 1;
      } catch (err) {
        failed += 1;
        // A @code-reviewer MINOR on the first pass: `(err as Error).message`
        // is logged verbatim, the #9/#12/#27/#46/#48 per-row-isolation
        // shape — but unlike those, a failure inside `run()` can originate
        // from a Prisma error whose message embeds query parameter values.
        // Every failure path this loop actually reaches (findLatestByCustomerId
        // / this.run) throws only NotFoundException or a Prisma error keyed
        // on `customer.id` (already an identifier, not PII) — never a
        // message built from the customer's name or a screening list's
        // content. Logged here identifiers-only, matching this file's own
        // audit convention above (never a matched subject's PII).
        this.logger.error(
          `Recurring screening batch: customer ${customer.id} failed (${(err as Error).message}) — continuing.`,
        );
      }
    }
    if (unscreenable > 0) {
      this.logger.error(
        `Recurring screening batch: ${unscreenable} of ${screened} customer(s) could not be screened against any populated list — recorded PENDING_INVESTIGATION, NOT cleared. Run POST /watchlist-sync/run.`,
      );
    }
    return { screened, hits, failed, unscreenable };
  }
}
