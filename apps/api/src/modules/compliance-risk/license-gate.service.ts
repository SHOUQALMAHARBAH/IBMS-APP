import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { pickCurrentTerm } from './broker-license.config';
import {
  deriveLicenseStanding,
  insuranceBranchKey,
  type DerivedLicenseStanding,
  type InsuranceBranchRef,
} from './license-standing.config';
import { LegalValueService } from './legal-value.service';

/**
 * MAY THIS OFFICE PRACTISE — ONE ANSWER, AND THE GATE USES IT.
 *
 * ## WHAT WAS WRONG: THREE ANSWERS, AND ONLY THE NARROWEST ONE ENFORCED
 *
 * MEASURED before this existed:
 *
 *   (a) `deriveLicenseStanding` — decision 71's SIX states, with `mayPractise` beside them — had
 *       **zero non-spec consumers**. The considered answer was used nowhere that enforces.
 *   (b) `PolicyService.assertLicenseNotLapsed` computed its own, from `pickCurrentTerm` plus
 *       `isBrokerLicenseCurrentlyLapsed`, and was PRIVATE with exactly ONE caller — the
 *       policy-creation path at `policy.service.ts:553`. Every other art. 21/a/9 occurrence in the
 *       tree is a comment, a display string or the provider dashboard's wording.
 *   (c) `BrokerLicense.status`, a stored two-value column, against the derivation's six.
 *
 * Three answers to one question, and the copy is the one that drifts. The consequence was concrete
 * and is the reason this batch exists: **a CBJ SUSPENSION did not block anything.** The derivation
 * knew about it; the gate never asked.
 *
 * ## WHY A `@Global()` SERVICE, WHICH THIS PROJECT OTHERWISE AVOIDS
 *
 * Services are not shared here — repositories are. The two standing exceptions are both ENGINES
 * that every call site must pass through: `WorkflowTransitionService`, because every status change
 * must go through one implementation, and `DutySegregationService`, whose module says it plainly —
 * *"the alternative — each module injecting three repositories and calling a free function — puts
 * the mode read, the reason check and the act write in fourteen places, which is exactly what this
 * exists to prevent."*
 *
 * "Is this office licensed" is that shape. Six acts in five modules must refuse, and the brief's own
 * instruction is ONE GATE, NOT FIVE COPIES — five private copies would be five answers to one
 * question, which is the defect above reproduced on a larger surface. The pure derivation stays
 * where it is and is still unit-testable without a database; what lives here is the READ and the
 * REFUSAL, which are the two things that would otherwise be duplicated.
 *
 * ## TWO PROPERTIES OF THE OLD GATE SURVIVE, AND BOTH ARE DELIBERATE
 *
 *   1. **The LATEST term decides, not the one covering today.** Between filing a renewal (art. 11,
 *      45 days before expiry) and the old term running out, an office legitimately holds two, and
 *      the newer one says whether it may practise. `pickCurrentTerm` is that reading and is reused
 *      rather than re-derived.
 *   2. **It is a LIVE RECOMPUTE, never a stored-flag read.** The block is correct the INSTANT
 *      `expiresAt` passes, rather than after a sweep has run. Nothing is cached here and nothing
 *      should be: a cached answer is a fourth answer.
 *
 * `license-gate.inventory.spec.ts` asserts both, because a later edit that reached for a stored
 * column or for "the term covering today" would look tidier and be wrong.
 *
 * ## AND THE MECHANISM THAT LIFTS THE BLOCK WAS ALREADY THE MECHANISM
 *
 * `BrokerLicense.certificateDocumentId` is NOT NULL, so recording the new term WITH its certificate
 * is what makes the office practising again — there is no separate "unblock" act and there must not
 * be one. This batch widens that; it does not invent it.
 */

/**
 * THE ACTS THIS GATE REFUSES — a closed list, so the refusal can NAME the act and the set is
 * auditable from one place.
 *
 * ز.١, measured against the code: `PLACE_POLICY` was the only one enforced. The other five are what
 * this batch adds.
 */
export const LICENCE_GATED_ACTS = {
  PLACE_POLICY: 'placing new business',
  RENEW_POLICY: 'renewing a policy',
  REQUEST_QUOTES: 'sending a new quote request to insurers',
  ISSUE_RECOMMENDATION: 'issuing a recommendation to the customer',
  INCREASE_COVER: 'applying an endorsement that increases cover',
  ISSUE_CERTIFICATE: 'issuing an insurance certificate',
} as const;

export type LicenceGatedAct = keyof typeof LICENCE_GATED_ACTS;

/**
 * WHAT IS DELIBERATELY NOT HERE — ز.٢, and the omission is as load-bearing as the list above.
 *
 * The owner's words: «في عندو حسابات مفتوحة ومصاري لسا مش مسدَّدة بده يكمّلها وهذا حقّه». An office
 * whose licence has ended keeps the right to finish what it already has, so NONE of these is gated:
 *
 *   - collection and remittance on existing policies;
 *   - claims in full — logging, following, settling;
 *   - an endorsement that REDUCES cover, and a cancellation;
 *   - statements and internal reports;
 *   - compliance and data-protection work.
 *
 * **An over-wide block is a worse defect than the missing one**, because it stops lawful work and
 * looks like compliance. Each of those is asserted as SUCCEEDING with a lapsed licence in
 * `license-gate.e2e-spec.ts` — a positive assertion, because an absence of refusal is not something
 * a negative test can show.
 */
export const LICENCE_UNGATED_ACTS = [
  'collection and remittance on existing policies',
  'claims — logging, following and settling',
  'an endorsement that reduces cover, and a cancellation',
  'statements and internal reports',
  'compliance and data-protection work',
] as const;

/**
 * 🔴 OWNER DECISION 128 — WHAT A PERMITTED ISSUANCE CARRIES WITH IT.
 *
 * An OBJECT rather than a bare `string | null`, and the reason is the one `InsuranceBranchRef`
 * records one type up: a bare nullable string at five call sites is five chances to store it
 * in the wrong column or to forget which way round null means. A named field cannot be
 * mistaken for anything else.
 *
 * Callers that do not create a record ignore it, which is why `assertMayPractise` returning a
 * value breaks nothing: the five that DO create one spread it into their `data`.
 */
export interface IssuanceStamp {
  /** The term the office was PAST THE EXPIRY OF when this was issued, or null — which is the
   *  ordinary case and means «issued under a licence that was simply in force». */
  issuedUnderStudyLicenseId: string | null;
  /**
   * 🔴 OWNER DECISION 153 RULING 2 — the CBJ licence number of the term in force at this
   * instant, for the certificate that prints it.
   *
   * ⛔ CARRIED FROM THE SAME READ rather than fetched again, for the reason the comment on
   * `standingWithTerm` already gives about the id beside it: asking the licence a second time
   * asks at a second INSTANT, and a certificate issued in between would name a term the office
   * had already left. One read, one instant, one answer.
   *
   * ⚠️ Null ONLY where there is no term at all — which `deriveLicenseStanding` answers
   * `NO_TERM_ON_RECORD` / `mayPractise: false` for, and `assertMayPractise` throws on three
   * lines below. So every caller that receives a stamp receives a number; the type is nullable
   * because TypeScript cannot see that refusal, not because the case is reachable.
   */
  currentLicenseNumber: string | null;
}

@Injectable()
export class LicenseGateService {
  constructor(
    private readonly licenses: BrokerLicenseRepository,
    private readonly acts: RegulatoryActionRepository,
    /** OWNER DECISION 123 — art. 11's 45 days and art. 14/c's two years are `LegalValue` rows. */
    private readonly legalValues: LegalValueService,
  ) {}

  /**
   * The office's standing today — the ONE answer, live.
   *
   * `now` defaults rather than being required, so a caller who passes nothing still gets a correct
   * live answer and a test can still pin a boundary. The failure direction of forgetting is
   * correctness.
   */
  async standing(now: Date = new Date()): Promise<DerivedLicenseStanding> {
    return (await this.standingWithTerm(now)).standing;
  }

  /**
   * 🔴 OWNER DECISION 128 — THE STANDING **AND** THE TERM IT WAS DERIVED FROM, in one pass.
   *
   * The stamp names the term a record was issued under, and `DerivedLicenseStanding` has no
   * id on it — deliberately: `deriveLicenseStanding` is PURE and is shared with a provider
   * dashboard that must never learn an office's row ids.
   *
   * ⛔ SO THE ID IS CARRIED HERE RATHER THAN RE-READ. The obvious alternative — ask the gate
   * for the standing, then read the licence again for its id — doubles the three reads on
   * the hot path (every placement) and, worse, reads the licence at a second instant: an
   * office whose certificate landed between the two calls would be stamped with a term it
   * was no longer under. One read, one instant, one answer.
   */
  private async standingWithTerm(now: Date = new Date()): Promise<{
    standing: DerivedLicenseStanding;
    currentTermId: string | null;
    /** OWNER DECISION 153 RULING 2 — the same term's licence number, from the SAME read. */
    currentLicenseNumber: string | null;
  }> {
    // THREE READS, ONE ROUND TRIP, ONE INSTANT. The legal figures join the terms and the acts
    // rather than being fetched inside the derivation: OWNER DECISION 123 made art. 11's span and
    // art. 14/c's limit rows, and `deriveLicenseStanding` must stay PURE — its whole value is that
    // a provider dashboard and the gate share one implementation and one test suite.
    const [terms, acts, figures] = await Promise.all([
      this.licenses.findTerms(),
      this.acts.findAll(),
      this.legalValues.licenceFigures(now),
    ]);
    /*
     * 🔴 OWNER DECISION 128 — THE RELATION CROSSES HERE, at the one boundary between the
     * database's row and the pure derivation, exactly as the scope lines become branch keys below.
     *
     * ⚠️ IT MUST BE MAPPED EXPLICITLY. `LicenseTermRow.renewalDeclaration` is OPTIONAL so that
     * every existing fixture compiles, which means forgetting this line would leave it `undefined`
     * — read as «nobody declared» — and an office that HAD declared would be refused for ever,
     * silently and with the wrong sentence. Optional-reads-as-absent is the safe direction for a
     * fixture and the dangerous one for the real path, so the real path states it.
     *
     * 🔴 OWNER DECISION 159 RULING 3 — AND IT IS THE ROW NOW, NOT `!== null`. The derivation
     * reads its presence as the boolean and its two columns as the facts the screen prints, so
     * «did anyone declare» and «who, and when» cannot disagree.
     */
    const current = pickCurrentTerm(terms);
    const standing = deriveLicenseStanding(
      current === null
        ? null
        : {
            ...current,
            renewalDeclaration: current.renewalDeclaration,
          },
      /*
       * Art. 21/b/5 — the scope lines become `insuranceBranchKey`s HERE, at the one boundary
       * between the database's two nullable columns and the derivation's single key. The derivation
       * stays pure and never sees a nullable pair, so it cannot compare two NULLs and read them as
       * the same branch.
       */
      acts.map((a) => ({
        ...a,
        scopeKeys: a.scopeLines
          .map((line) => insuranceBranchKey(line))
          .filter((key): key is string => key !== null),
      })),
      now,
      figures,
    );
    return {
      standing,
      currentTermId: current?.id ?? null,
      currentLicenseNumber: current?.licenseNumber ?? null,
    };
  }

  /**
   * Refuse `act` unless the office may practise.
   *
   * The refusal NAMES THE ACT and NAMES THE STANDING, because "blocked" alone sends a reader to
   * guess which of six states they are in — and the six are not interchangeable: an office with no
   * term on record has a different thing to do from one whose licence the CBJ suspended.
   */
  /*
   * `branch` IS REQUIRED, with no default, and that is deliberate.
   *
   * A default of `null` would compile at every existing call site and then refuse them all the day
   * a partial suspension is recorded — correct in direction and invisible until it bites. Required,
   * the COMPILER asks each of the eight call sites which insurance branch its act belongs to, and a
   * site that genuinely cannot answer passes `null` on purpose with its reason beside it. That is
   * the form that cannot express the mistake rather than the form that requires noticing it.
   */
  async assertMayPractise(
    act: LicenceGatedAct,
    branch: InsuranceBranchSource,
    now: Date = new Date(),
  ): Promise<IssuanceStamp> {
    const { standing, currentTermId, currentLicenseNumber } =
      await this.standingWithTerm(now);
    if (!standing.mayPractise) {
      throw new UnprocessableEntityException(refusal(act, standing));
    }
    /*
     * 🔴 OWNER DECISION 128 — THE STAMP, decided ONCE, HERE, at the moment the act is
     * permitted.
     *
     * It is `null` on every ordinary issuance, which is almost all of them. It names the term
     * only while the office is PAST its printed expiry with all four conditions met — the
     * `UNDER_STUDY` state and no other, so a record issued in an ordinary RENEWAL_PENDING
     * window (filed 45 days early, licence still in force) is NOT stamped. The gap decision
     * 128 §4 records is the gap BETWEEN two licences, not the run-up to one.
     *
     * ⛔ Computed at CREATION and handed to the caller to store. Never derived later: the new
     * certificate arriving would otherwise silently un-stamp every record issued in the gap,
     * and an inspector asking what was issued under study would be told «nothing».
     */
    const stamp: IssuanceStamp = {
      issuedUnderStudyLicenseId:
        standing.renewalUnderStudy.state === 'UNDER_STUDY'
          ? currentTermId
          : null,
      // OWNER DECISION 153 RULING 2 — unconditional, unlike the stamp above: the certificate
      // names the licence it was issued under whatever state that licence is in, and the only
      // state with no number is the one `mayPractise` already refused.
      currentLicenseNumber,
    };
    if (standing.blockedInsuranceBranchKeys.length === 0) return stamp;

    /*
     * ART. 21/b/5 — THE OFFICE IS STOPPED IN SOME BRANCHES AND TRADING IN THE REST.
     *
     * THE UNRESOLVED CASE REFUSES, and that is the load-bearing decision in this method.
     *
     * A caller that cannot name the branch its act belongs to leaves the gate unable to tell a
     * permitted act from a forbidden one. Permitting would make a recorded CBJ suspension block
     * nothing while the screen shows it as in force — a suspension that exists in the register and
     * not in the product, which is worse than refusing, because nobody finds out. Refusing is
     * visible on the first attempt and names what is missing.
     *
     * It costs nothing until a scoped act exists: `blockedInsuranceBranchKeys` is empty for every
     * office with no partial suspension, and the method has already returned above.
     */
    const resolved = typeof branch === 'function' ? await branch() : branch;
    const key = resolved === null ? null : insuranceBranchKey(resolved);
    if (key === null) {
      throw new UnprocessableEntityException(
        `${LICENCE_GATED_ACTS[act]} is blocked — the CBJ has limited this office's licence to some ` +
          `insurance branches (art. 21/b/5), and this request does not say which branch it belongs ` +
          `to, so the limit cannot be applied to it. This is a gap in the request rather than a ` +
          `decision about the office: the act is refused rather than allowed through an unchecked ` +
          `licence limit.`,
      );
    }
    if (standing.blockedInsuranceBranchKeys.includes(key)) {
      throw new UnprocessableEntityException(
        `${capitalise(LICENCE_GATED_ACTS[act])} is blocked — the CBJ has suspended or cancelled ` +
          `this office's licence in the insurance branch this request belongs to, while leaving the ` +
          `rest of the licence in force (CBJ Instructions No. 9 of 2026, art. 21/b/5). Practising in ` +
          `a branch the office is stopped in is a ground for administrative sanction (art. 21/a/9). ` +
          `Business in the office's other branches is not affected, and neither is work on existing ` +
          `business in this one — collection, claims, cancellations, reporting and compliance.`,
      );
    }
    return stamp;
  }
}

/**
 * WHERE A CALL SITE'S INSURANCE BRANCH COMES FROM — a value, `null`, or a THUNK.
 *
 * The thunk is not a convenience. `rfq.service.ts` gates BEFORE it reads the opportunity, on a
 * documented ordering argument — *"the licence is the thing the caller cannot change by editing the
 * request"* — and the branch is only knowable AFTER that read, from the programme line the RFQ
 * inherits. A value-only parameter would have forced one of two bad choices: move the gate after
 * the reads and lose the ordering, or pass `null` and refuse every RFQ in an office with any
 * partial suspension.
 *
 * Lazy, so the extra read happens ONLY when a partial suspension actually exists — the gate checks
 * `blockedInsuranceBranchKeys` first and returns before ever calling the thunk. On every office
 * today that is every call: zero added queries.
 */
export type InsuranceBranchSource =
  InsuranceBranchRef | null | (() => Promise<InsuranceBranchRef | null>);

/**
 * The refusal sentence — exported and PURE, so its wording is unit-testable without a database and
 * so the six states each get their own clause rather than one generic line.
 *
 * It cites art. 21/a/9 once, where the article is what makes the refusal a refusal, and it names
 * what lifts the block: recording the new term WITH its certificate. A refusal that does not say
 * the way out gets escalated as a system fault.
 */
/**
 * 🔴 OWNER DECISION 136(ب) — THE SENTENCE SHOWN WHEN THE OFFICE IS UNDER STUDY AND NOBODY HAS
 * DECLARED YET. The one Arabic string the api serves on this path, and it is served rather than
 * translated in the web for a measured reason: every screen that attempts an issuance renders
 * `err.message` RAW from the api (`rfqs/new/page.tsx:156` and four siblings), so a sentence kept
 * only in a dictionary would never reach the person being refused.
 *
 * ## WHERE ITS WORDS COME FROM — decision 136 §5, and two of the three already ship
 *
 *   «قيدَ التجديد»                    — `compliance-risk.ts`, `rcStandingRenewalPending`
 *   «راجع مسؤول النظام في مكتبك.»     — `operations.ts`, the no-screen-assigned line
 *   «ولم يُسجَّل الإقرار بعد»          — NEW, ratified by the owner in decision 136
 *
 * ⛔ SLICED BYTE-FOR-BYTE from `docs/decision-136-...md` and never retyped.
 * `license-renewal.spec.ts` re-slices it from that file and compares, AND asserts both shipping
 * fragments appear inside it — so changing the wording here, or drifting from either dictionary,
 * fails by name.
 *
 * ⛔ AND IT NEVER SAYS «ساري» OR «حكماً». Decision 128 §4: the licence IS expired, the state word
 * is «قيد التجديد», and claiming the licence is in force would be the system asserting something
 * the instrument's art. 21/a/9 contradicts.
 */
export const RENEWAL_AWAITING_DECLARATION_REFUSAL_AR =
  'الترخيص قيدَ التجديد، ولم يُسجَّل الإقرار بعد. راجع مسؤول النظام في مكتبك.';

export function refusal(
  act: LicenceGatedAct,
  standing: DerivedLicenseStanding,
): string {
  /*
   * 🔴 OWNER DECISION 136(ب) — AND IT RETURNS EARLY, BEFORE THE ENGLISH SENTENCE IS BUILT.
   *
   * The office filed on time, attached its proof, and has had no deficiency notice and no
   * refusal. The ONLY thing missing is the standing declaration — which its own administrator
   * can enable in one grant. So the person attempting the issuance is not told their licence has
   * expired (true, but useless to them); they are told what is missing and who to see.
   *
   * ⚠️ `status` is `EXPIRED` in this state, deliberately — the term IS past its printed date and
   * the derivation must not claim otherwise. That is exactly why the refusal reads
   * `renewalUnderStudy` and not `status`: a label cannot carry the difference between «your
   * licence ran out» and «your office has one click left to make».
   */
  if (standing.renewalUnderStudy.state === 'AWAITING_DECLARATION') {
    return RENEWAL_AWAITING_DECLARATION_REFUSAL_AR;
  }
  const what = LICENCE_GATED_ACTS[act];
  const because = (() => {
    switch (standing.status) {
      case 'NO_TERM_ON_RECORD':
        return 'this office holds no CBJ broker licence term on record';
      case 'EXPIRED':
        return "the office's CBJ broker licence has expired";
      case 'SUSPENDED':
        return standing.standingActDecisionRef === null
          ? "the office's licence is recorded as suspended, with no CBJ decision reference on record"
          : `the CBJ has suspended the office's licence (decision ${standing.standingActDecisionRef})`;
      case 'CANCELLED':
        return standing.deemedCancelledUnderArticle14C
          ? "the office's licence is deemed cancelled — a suspension at the broker's own request has stood for more than two years (art. 14/c)"
          : standing.standingActDecisionRef === null
            ? "the office's licence is recorded as cancelled"
            : `the CBJ has cancelled the office's licence (decision ${standing.standingActDecisionRef})`;
      default:
        // ACTIVE and RENEWAL_PENDING both carry `mayPractise: true`, so this is unreachable from
        // `assertMayPractise`. Kept total rather than defaulted to a sentence, because a seventh
        // state added later must fail the compiler here rather than produce a vague refusal.
        return 'the office may not currently practise';
    }
  })();

  return (
    `${capitalise(what)} is blocked — ${because}. Practising without a current licence is a ground ` +
    `for administrative sanction (CBJ Instructions No. 9 of 2026, art. 21/a/9). Recording the ` +
    `office's current licence term together with its certificate is what lifts this; work on ` +
    `existing business — collection, claims, cancellations, reporting and compliance — is not ` +
    `affected.`
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
