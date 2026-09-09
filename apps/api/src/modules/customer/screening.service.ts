import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Customer, RiskLevel, ScreeningResult } from '@ibms/db';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import { AuditService } from '../audit/audit.service';
import { matchesSampleWatchlist } from './sample-watchlist';
import {
  canonicalNameTokens,
  classifyMatch,
  type WatchlistMatchType,
} from '../compliance-risk/watchlist-match.config';
import { ScreeningMatchRepository } from '../../repositories/screening-match.repository';

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
}

export interface ScreeningBatchResult {
  screened: number;
  hits: number;
  failed: number;
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
 * every 12 hours; matched on `normalizeWatchlistName`'s canonical form, an
 * exact match, not fuzzy — see `watchlist-sync.config.ts` and
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
    const real = await this.findRealWatchlistMatches(kycRecordId, subjectNames);
    const hit: WatchlistHit | undefined = fixtureHit ?? real.hit ?? undefined;
    const anyHit = hit !== undefined;

    for (const screeningType of SCREENING_TYPES) {
      const result = await this.kycRecords.createScreeningResult({
        kycRecordId,
        screeningType,
        result: hit ? 'HIT' : 'CLEAR',
        listSource: hit?.listSource,
        escalatedToComplianceAt: hit ? now : undefined,
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

    return { results, riskLevel, isEdd: nextIsEdd, newHit: anyHit };
  }

  /**
   * The real (non-fixture) watchlist check against the synced
   * `WatchlistEntry` cache. Runs in every environment, production included.
   *
   * Matching is CONTAINMENT, not equality (Process 49 fuzzy matching): an
   * entry matches when every one of its canonical tokens appears in the
   * subject's. The previous exact-equality version silently missed the two
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
  ): Promise<{ hit: WatchlistHit | undefined; candidates: number }> {
    let hit: WatchlistHit | undefined;
    let candidates = 0;

    for (const name of subjectNames) {
      const subjectTokens = canonicalNameTokens(name);
      if (subjectTokens.length === 0) continue;

      const entries =
        await this.watchlistEntries.findContainedCandidates(subjectTokens);

      for (const entry of entries) {
        const matchType = classifyMatch(name, entry.fullName);
        candidates += 1;

        // The `@@unique(kycRecordId, watchlistEntryId, subjectName)` is the
        // real guard, not a findFirst check: the 4-hourly recurring batch
        // re-screens every active customer, and without it each pass would
        // mint a duplicate queue item. A concurrent duplicate is a no-op.
        await this.screeningMatches.recordCandidate({
          kycRecordId,
          watchlistEntryId: entry.id,
          subjectName: name,
          matchType,
        });

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

    return { hit, candidates };
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
        const { newHit } = await this.run(kyc.id, actorUserId);
        screened += 1;
        if (newHit) hits += 1;
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
    return { screened, hits, failed };
  }
}
