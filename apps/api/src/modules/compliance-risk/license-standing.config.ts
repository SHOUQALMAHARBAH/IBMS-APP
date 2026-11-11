import {
  isBrokerLicenseCurrentlyLapsed,
  isValidPendingRenewalDecision,
} from './broker-license.config';
import type { LicenceLegalFigures } from './legal-figures.config';

/**
 * MODULE 0-ب ITEM (d) — THE LICENCE STATUS IS DERIVED. WHAT IS STORED IS THE REGULATOR'S ACT.
 *
 * Decision 71, and the corrected field dictionary records it against the field itself:
 *
 *   «حالة الترخيص لا تُخزَّن. تُحسَب من تواريخ مدّة الترخيص + طلب التجديد إن قُدِّم + أيِّ فعلٍ
 *    رقابيٍّ قائم ... والمخزَّنُ وحده هو فعلُ الجهة الرقابية»
 *
 * So there is no `licenseStatusId` column anywhere, and there must not be one. A stored status is a
 * second home for a fact the dates already answer, and the copy is the one that goes stale — which
 * in this case means an office reported as licensed after its licence ended, or refused while it is
 * still valid.
 *
 * ## WHY THIS IS A SEPARATE FILE FROM `broker-license.config.ts`
 *
 * That file answers questions about ONE TERM — is it past its printed expiry, was a renewal filed by
 * art. 11's deadline, does the expiry fall on 31 December. Those are arithmetic over a row.
 *
 * This file answers a question about an OFFICE, and it needs something that file has never had: the
 * acts the regulator has taken. A suspension is not a property of a licence term — it outlives the
 * term, it can arrive mid-term, and it is recorded against the organization. Folding it into
 * `isBrokerLicenseCurrentlyLapsed` would have meant giving every caller of that function an act list
 * it does not have, and there are callers (`PolicyService.place`, the provider dashboard's mapper)
 * whose whole point is that they are cheap.
 *
 * The term-level functions are REUSED here rather than reimplemented, for the reason the provider
 * dashboard already records: a second copy of the lapse rule in a second place is a second answer,
 * and a dashboard calling an office lapsed while the application lets it place business is worse
 * than no dashboard.
 *
 * ## THE SHEET NAMES FOUR STATUSES AND THE HONEST ANSWER IS SIX — a measurement against the brief
 *
 * «ساري / موقوف / ملغى / قيد التجديد» — active, suspended, cancelled, under renewal. Two states
 * this system can really be in are missing from that list, and both already exist in the codebase
 * rather than being invented here:
 *
 *   * NO_TERM_ON_RECORD. Module 0 item (c) made the absence of any licence term BLOCK new business
 *     under art. 21/a/9, and `isCurrentlyLapsed === null` has meant "no term on record" since the
 *     provider dashboard shipped — deliberately NOT collapsed into "lapsed", because reporting an
 *     expiry where none was ever recorded hides the worse state behind the milder one.
 *   * EXPIRED. A term past 31 December with no timely renewal application is not «موقوف» (nobody
 *     suspended it) and not «ملغى» (nobody cancelled it). It ran out.
 *
 * Collapsing either into one of the sheet's four would make a false statement about why an office
 * cannot trade, which is the question Compliance asks first.
 *
 * ## THE LABEL AND THE PERMISSION ARE TWO QUESTIONS
 *
 * `mayPractise` is returned beside `status` and is not derivable from it by a reader: RENEWAL_PENDING
 * may practise, EXPIRED may not, and both are past the printed expiry. This is the same split
 * `validPendingRenewalDecision` exists to preserve one level down — collapsing them leaves an officer
 * looking at an expiry in the past with nothing explaining why the system is content.
 */

export const DERIVED_LICENSE_STATUSES = [
  'NO_TERM_ON_RECORD',
  'ACTIVE',
  'RENEWAL_PENDING',
  'EXPIRED',
  'SUSPENDED',
  'CANCELLED',
] as const;
export type DerivedLicenseStatus = (typeof DERIVED_LICENSE_STATUSES)[number];

/*
 * ART. 14/c's TWO YEARS IS A ROW NOW — OWNER DECISION 123, module 1.
 *
 * `export const ARTICLE_14C_SUSPENSION_LIMIT_YEARS = 2` stood here, declared in
 * `check:legal-numbers` with its reason. It is `LegalValue` code
 * `ARTICLE_14C_SUSPENSION_LIMIT_YEARS`, art. 14/c, printed page 16 —
 * «في حال تجاوزت مدة وقف الترخيص سنتين يعتبر الترخيص ملغى حكماً».
 *
 * THE READING SURVIVES THE MOVE: art. 14/c is applied to the LICENCE and never per insurance
 * branch, because its text is the suspension of the licence. `foldScopedActs` below says so at
 * the place that would otherwise be tempted.
 */

/** One row of `RegulatoryAction`, as the derivation needs it. */
export interface RegulatoryActRow {
  kind: 'SUSPENSION' | 'CANCELLATION' | 'REINSTATEMENT';
  basis: 'BROKER_REQUEST' | 'SANCTION';
  effectiveFrom: Date;
  suspendedUntil: Date | null;
  decisionRef: string;
  /**
   * WHEN THE ROW WAS WRITTEN — the TIE-BREAK, and only the tie-break.
   *
   * Whether an act is in force is decided by `effectiveFrom` and must never consult this: a
   * suspension dated last month entered today WAS in force for that month, which is what that
   * column's own comment says.
   *
   * But `effectiveFrom` is `@db.Date`, so two acts on one day are EQUAL to it — and a suspension
   * and the reinstatement that lifts it can genuinely bear one date. Without this the fold order
   * was whatever the query plan returned, and the office's standing was decided by it. Found by an
   * e2e failing in a spec about recommendations.
   */
  recordedAt: Date;
  /** The final tie-break, so the comparator is TOTAL. Two acts sharing a date AND an instant is
   *  pathological; a comparator that can return 0 is one whose answer depends on input order. */
  id: string;
  /**
   * ART. 21/b/5 — THE INSURANCE BRANCHES THIS ACT IS LIMITED TO. **EMPTY MEANS THE WHOLE LICENCE**,
   * which is what makes every act written before `RegulatoryActionScopeLine` existed keep its
   * meaning (measured: 0 rows on dev when that table landed, so nothing was reinterpreted).
   */
  scopeKeys?: readonly string[];
}

/**
 * An insurance branch, as both a scope line and a transaction name it: EITHER a standard catalogue
 * line OR an office's own addition.
 */
export interface InsuranceBranchRef {
  /*
   * BOTH REQUIRED, though either may be null — and the difference is not pedantry. With both
   * OPTIONAL, any object at all structurally satisfies this type, so a call site could hand the
   * gate a row that carries no line columns, `insuranceBranchKey` would return null, and the act
   * would be refused for a reason nobody could see. Fail-closed is the safe direction and a SILENT
   * one is still a defect. Required means the compiler asks for both columns by name.
   */
  insuranceLineId: string | null;
  officeInsuranceLineId: string | null;
}

/**
 * ONE STRING FOR ONE BRANCH — the single home of the keying rule.
 *
 * The alternative is carrying a (standard, office) pair through the fold, the standing, the gate and
 * every call site, and comparing two nullable columns at each. Two nullable fields compared by hand
 * in six places is six chances to write `a.insuranceLineId === b.insuranceLineId` and have two rows
 * whose columns are both NULL read as the same branch — the § 1.25 NULL-distinctness trap arriving
 * in TypeScript instead of in an index.
 *
 * Returns null when neither is named, which the gate treats as "the caller could not resolve the
 * branch" and REFUSES on. A CHECK constraint already makes a scope-line row impossible in that
 * state; a transaction, by contrast, really can fail to resolve one, and that is not a permit.
 */
export function insuranceBranchKey(ref: InsuranceBranchRef): string | null {
  if (ref.insuranceLineId) return `std:${ref.insuranceLineId}`;
  if (ref.officeInsuranceLineId) return `off:${ref.officeInsuranceLineId}`;
  return null;
}

/** The term, as the derivation needs it. A subset of `BrokerLicenseRow` on purpose: this function
 *  must not grow a dependency on the certificate or the scope lines. */
export interface LicenseTermRow {
  issuedAt: Date | null;
  expiresAt: Date;
  renewalRequestedAt: Date | null;
}

export interface DerivedLicenseStanding {
  status: DerivedLicenseStatus;
  /** May this office place new business today? NOT derivable from `status` by a reader — see the
   *  header. The caller that blocks placement reads THIS, never the label. */
  mayPractise: boolean;
  /** The CBJ decision behind a SUSPENDED/CANCELLED standing, so a screen can name it rather than
   *  asserting a regulatory act with nothing to cite. Null for every other status. */
  standingActDecisionRef: string | null;
  /** True only where the cancellation was DERIVED from art. 14/c rather than recorded as an act.
   *  A screen must be able to tell "the CBJ cancelled this" from "this lapsed into cancellation by
   *  operation of law", because only the second one is something the office can still be surprised
   *  by. */
  deemedCancelledUnderArticle14C: boolean;
  /**
   * ART. 21/b/5 — the insurance branches the office may NOT trade in today, while the licence as a
   * whole still permits practice. `insuranceBranchKey`'s keys, sorted, so the value is stable.
   *
   * SEPARATE FROM `status` AND FROM `mayPractise`, and that separation is the whole design:
   *
   *  - A partial suspension must NOT report the office SUSPENDED. «في فرع أو أكثر من فروع التأمين»
   *    is the regulator stopping part of the business, and an office stopped in motor is still
   *    licensed and still trading in medical. Reporting it SUSPENDED would block everything, which
   *    is the error the one-bit licence already made.
   *  - And it must not be derivable from `status` by a reader, for the same reason `mayPractise`
   *    is not: the caller that blocks an act reads this list, never a label.
   *
   * EMPTY on every office that has no scoped act — which is every office today — so the common path
   * is unchanged and costs one length check.
   */
  blockedInsuranceBranchKeys: readonly string[];
}

/** Two calendar years after `from`, by year arithmetic rather than by adding 730 days — a leap year
 *  makes the day count wrong by one, in the direction that cancels an office a day early. */
function yearsAfter(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * THE ACT THAT IS STANDING TODAY, or null.
 *
 * Three filters, and each is load-bearing:
 *
 *  1. An act takes effect on `effectiveFrom`, so one dated in the future is recorded and not yet in
 *     force. The column's own comment makes the opposite point — an act dated last month entered
 *     today WAS in force for that month — which is why the comparison is against the date and never
 *     against `recordedAt`.
 *
 *  2. An act predating the CURRENT TERM'S ISSUE does not bite, and this is what makes a re-licensed
 *     office expressible at all. Art. 14/c ends with «وعلى الوسيط تقديم طلب ترخيص جديد» — the way
 *     back from a cancellation is a NEW LICENCE, not a reinstatement — so an office that was
 *     cancelled and later re-licensed carries a cancellation act forever. The new TERM is the
 *     regulator acting again, exactly as the next term IS the renewal decision and is why no
 *     `renewalDecidedAt` column exists.
 *
 *     On an equal date the ACT wins, which is the stricter reading of a genuinely pathological case
 *     (a term issued the same day a cancellation takes effect).
 *
 *  3. The acts are folded in `effectiveFrom` order: a suspension suspends, a reinstatement (art.
 *     14/b) clears it, a cancellation cancels. Append-only, so the fold is the whole history and
 *     nothing is mutated.
 */
function foldActs(
  acts: readonly RegulatoryActRow[],
  termIssuedAt: Date | null,
  now: Date,
): {
  suspension: RegulatoryActRow | null;
  cancellation: RegulatoryActRow | null;
} {
  const inForce = acts
    .filter((a) => a.effectiveFrom.getTime() <= now.getTime())
    .filter(
      (a) =>
        termIssuedAt === null ||
        a.effectiveFrom.getTime() >= termIssuedAt.getTime(),
    )
    .slice()
    /*
     * A TOTAL ORDER — `effectiveFrom`, then `recordedAt`, then `id`.
     *
     * It was `effectiveFrom` alone, and `effectiveFrom` is a DATE. So a suspension and its
     * reinstatement bearing one date folded in whatever order the query returned, and WHETHER THE
     * OFFICE MAY TRADE was decided by the query plan. The e2e caught it as a 422 on a recommendation
     * send — a request with nothing to do with the licence — after the office's own reinstatement
     * had been recorded.
     *
     * Same class as `findActiveUserIdsWithPermission`, which had no `orderBy` while its consumer
     * took `[0]`: it passed at 46,153 rows and failed at 23. A fold imposes an ordering requirement
     * that nothing type-checks, so the order belongs in the comparator with the reason beside it.
     */
    .sort(
      (a, b) =>
        a.effectiveFrom.getTime() - b.effectiveFrom.getTime() ||
        a.recordedAt.getTime() - b.recordedAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  let suspension: RegulatoryActRow | null = null;
  let cancellation: RegulatoryActRow | null = null;
  for (const act of inForce) {
    if (act.kind === 'CANCELLATION') {
      cancellation = act;
      suspension = null;
      continue;
    }
    if (act.kind === 'REINSTATEMENT') {
      // Art. 14/b — re-entry in the register. It clears a suspension AND a cancellation, because a
      // CBJ decision re-entering the broker is the regulator undoing its own act; art. 14/c's
      // deemed cancellation is derived rather than recorded, so it cannot be reinstated away and is
      // handled below on the suspension that produced it.
      suspension = null;
      cancellation = null;
      continue;
    }
    suspension = act;
  }

  // A sanction's period runs out on its own (art. 21/b: «وللمدة التي يراها مناسبة»). Derived, so
  // nothing has to sweep it — the office stops being suspended the moment the date passes.
  if (
    suspension?.suspendedUntil &&
    suspension.suspendedUntil.getTime() < now.getTime()
  ) {
    suspension = null;
  }

  return { suspension, cancellation };
}

/**
 * THE OFFICE'S LICENCE STANDING TODAY.
 *
 * `term` is the office's CURRENT term — `pickCurrentTerm`'s answer, the latest expiry — or null when
 * it holds none. `acts` is every `RegulatoryAction` recorded against the organization; the filtering
 * happens here rather than in the query so the caller cannot narrow it wrongly.
 *
 * Order of decision, and it is load-bearing in both directions:
 *
 *   1. The REGULATOR'S ACTS outrank the term arithmetic. An office inside a perfectly current term
 *      whose licence the CBJ has suspended may not trade, and reporting it ACTIVE because the dates
 *      look fine would be the system contradicting a regulator's decision.
 *   2. Within the acts, a CANCELLATION outranks a suspension.
 *   3. Art. 14/c converts a long-standing art. 14/a suspension into a cancellation — and ONLY an
 *      art. 14/a one. See the migration header: art. 21/b's suspension is a different act, states
 *      its own period, and whether 14/c reaches it is a question for the regulator, recorded rather
 *      than inferred.
 *   4. With no act standing, the answer is the term arithmetic that already existed.
 */
export function deriveLicenseStanding(
  term: LicenseTermRow | null,
  acts: readonly RegulatoryActRow[],
  now: Date,
  /** Art. 11's filing span and art. 14/c's limit, read from `LegalValue` at `now`. REQUIRED, with
   *  no default: a default would put the figures back into source, which is what decision 123
   *  moved out, and it would compile at every call site while doing it. */
  figures: LicenceLegalFigures,
): DerivedLicenseStanding {
  /*
   * ART. 21/b/5 — THE TWO FOLDS ARE SEPARATE, AND THE SPLIT IS WHAT KEEPS THE OLD ONE UNCHANGED.
   *
   * An act with no scope lines is office-wide and reaches the fold below exactly as it always did.
   * An act naming branches is folded per branch instead, and CANNOT move `status` or `mayPractise`:
   * «وقف ... في فرع أو أكثر من فروع التأمين» is a limit on the act, so letting it set the
   * office-wide status would turn "stopped in motor" into "stopped", which is the one-bit error
   * this table was added to end.
   *
   * The ordering is deliberate: the office-wide answer is computed FIRST and a branch block is only
   * reported while the licence as a whole permits practice. An office that is wholly suspended is
   * not "suspended in three branches"; it is suspended, and `mayPractise` is what the gate reads.
   */
  const isScoped = (a: RegulatoryActRow): boolean =>
    (a.scopeKeys?.length ?? 0) > 0;
  const base = deriveOfficeWideStanding(
    term,
    acts.filter((a) => !isScoped(a)),
    now,
    figures,
  );
  return {
    ...base,
    /*
     * EVERY act is passed, not just the scoped ones, and that is a correction rather than a choice:
     * filtering to the scoped acts meant an UNSCOPED REINSTATEMENT could never lift a branch block,
     * because the per-branch fold could not see it. Caught by its own test. Only scoped acts
     * contribute branch KEYS, so an office with no partial suspension still folds nothing.
     */
    blockedInsuranceBranchKeys: base.mayPractise
      ? foldScopedActs(acts, term?.issuedAt ?? null, now)
      : [],
  };
}

/**
 * ART. 21/b/5 — WHICH INSURANCE BRANCHES ARE BLOCKED TODAY, folded per branch.
 *
 * The same three filters and the same total comparator as `foldActs`, reused by calling it: a
 * second ordering rule for the same question is the drift this repo keeps paying for, and the
 * comparator's own comment records what a partial order cost here once.
 *
 * ART. 14/c IS DELIBERATELY NOT APPLIED PER BRANCH. Its text is «في حال تجاوزت مدة وقف الترخيص
 * سنتين» — the suspension of THE LICENCE, not of a branch — and the office-wide fold already
 * restricts it to an art. 14/a `BROKER_REQUEST`. Deeming a branch cancelled after two years would
 * be this system inferring a regulatory consequence from a provision that does not mention it.
 *
 * A scoped CANCELLATION lands in the same set as a scoped suspension, because the gate's question
 * is one question: may this office trade in this branch today. Telling a SCREEN which of the two it
 * is needs a second field and is owed when a screen names it; nothing renders this yet.
 */
function foldScopedActs(
  acts: readonly RegulatoryActRow[],
  termIssuedAt: Date | null,
  now: Date,
): readonly string[] {
  const keys = new Set<string>();
  for (const act of acts) for (const key of act.scopeKeys ?? []) keys.add(key);

  const blocked: string[] = [];
  for (const key of keys) {
    // Per branch, the acts that name it — plus every act that names NO branch, so an office-wide
    // reinstatement lifts a branch block. A CBJ decision re-entering the broker with no limitation
    // is the regulator undoing its own acts, and reading it as "everything except the branches"
    // would leave a block standing that the decision does not mention.
    const forBranch = acts.filter(
      (a) =>
        (a.scopeKeys?.length ?? 0) === 0 || (a.scopeKeys ?? []).includes(key),
    );
    const { suspension, cancellation } = foldActs(forBranch, termIssuedAt, now);
    if (suspension !== null || cancellation !== null) blocked.push(key);
  }
  // Sorted so the value is stable between reads — a caller comparing two standings, or a test
  // asserting the set, must not depend on `Set` insertion order.
  return blocked.sort();
}

function deriveOfficeWideStanding(
  term: LicenseTermRow | null,
  acts: readonly RegulatoryActRow[],
  now: Date,
  figures: LicenceLegalFigures,
): Omit<DerivedLicenseStanding, 'blockedInsuranceBranchKeys'> {
  if (!term) {
    /*
     * NO TERM ON RECORD — and it BLOCKS, which is module 0 item (c)'s decision under art. 21/a/9.
     * It is deliberately not reported as CANCELLED or EXPIRED: an office that never recorded a
     * licence is further from compliant than one whose licence merely ran out, because the lapsed
     * office can at least show what it once held.
     */
    return {
      status: 'NO_TERM_ON_RECORD',
      mayPractise: false,
      standingActDecisionRef: null,
      deemedCancelledUnderArticle14C: false,
    };
  }

  const { suspension, cancellation } = foldActs(acts, term.issuedAt, now);

  if (cancellation) {
    return {
      status: 'CANCELLED',
      mayPractise: false,
      standingActDecisionRef: cancellation.decisionRef,
      deemedCancelledUnderArticle14C: false,
    };
  }

  if (suspension) {
    const deemedCancelled =
      suspension.basis === 'BROKER_REQUEST' &&
      now.getTime() >
        yearsAfter(
          suspension.effectiveFrom,
          figures.article14cSuspensionLimitYears,
        ).getTime();
    return {
      status: deemedCancelled ? 'CANCELLED' : 'SUSPENDED',
      mayPractise: false,
      standingActDecisionRef: suspension.decisionRef,
      deemedCancelledUnderArticle14C: deemedCancelled,
    };
  }

  /*
   * THE MANUAL MARKER IS GONE, AND THAT IS THE COLLAPSE `docs/deferred-register.md` ENTRY 12 ASKED
   * FOR, IN ITS ORDER.
   *
   * A branch stood here reading `BrokerLicense.status === 'lapsed'` and reporting SUSPENDED with a
   * NULL decision reference. Its own comment called that null "the finding", because *"a suspension
   * nobody can cite is exactly the state `RegulatoryAction` exists to end"* — and nothing could
   * write that table, so the marker was the only live way to record one.
   *
   * It has a writer now: `POST /broker-license/regulatory-actions`, the office's own record of the
   * letter it received, carrying the basis, the effective date, the CBJ reference and the document.
   * So the marker was replaced before it was removed — entry 12's rule was "record acts for whatever
   * the marker was standing in for, THEN drop the column, never the reverse". MEASURED first: dev
   * held 3 terms, all `active`; db-test 4 active and 3 lapsed, every one an e2e artefact. Nothing
   * real was standing in for it.
   */

  /*
   * NO ACT STANDING — the term decides, through the functions that already decide it for
   * `PolicyService.place()`. Nothing is recomputed here.
   *
   * RENEWAL_PENDING is the sheet's «قيد التجديد» and is reached in TWO situations, which is wider
   * than the sheet's wording suggests and is deliberate: an office that filed its renewal 45 days
   * early is under renewal for those 45 days too, not merely after the term lapses. `mayPractise`
   * is true in both, so the wider reading costs nothing and the narrower one would report an office
   * ACTIVE while its renewal sits with the regulator — a fact Compliance wants on the screen.
   */
  if (
    term.renewalRequestedAt !== null &&
    !isBrokerLicenseCurrentlyLapsed(term, now, figures)
  ) {
    return {
      status: 'RENEWAL_PENDING',
      mayPractise: true,
      standingActDecisionRef: null,
      deemedCancelledUnderArticle14C: false,
    };
  }

  if (isValidPendingRenewalDecision(term, now, figures)) {
    // Past the printed expiry, a timely application pending a decision. Kept as its own branch
    // rather than folded above, because this one is reachable only through the owner's
    // renewal-pending rule and a reader has to be able to find it from that rule's name.
    return {
      status: 'RENEWAL_PENDING',
      mayPractise: true,
      standingActDecisionRef: null,
      deemedCancelledUnderArticle14C: false,
    };
  }

  if (isBrokerLicenseCurrentlyLapsed(term, now, figures)) {
    return {
      status: 'EXPIRED',
      mayPractise: false,
      standingActDecisionRef: null,
      deemedCancelledUnderArticle14C: false,
    };
  }

  return {
    status: 'ACTIVE',
    mayPractise: true,
    standingActDecisionRef: null,
    deemedCancelledUnderArticle14C: false,
  };
}
