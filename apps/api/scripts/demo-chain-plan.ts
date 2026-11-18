/**
 * THE DEMO'S DECLARED SHAPE — what stops where, and what the two offices are called.
 *
 * Pure data and pure functions. ⛔ No imports with side effects and no database: this module is
 * read by `seed-demo.script.ts` (which ends in a `test()` call and therefore cannot be imported
 * by anything) and by `demo-chain-plan.spec.ts`, which runs in the ordinary api unit suite.
 *
 * ## Why the plan is declared rather than written inline
 *
 * Message 46 §2.1 asks for chains that halt ON PURPOSE, so a presenter can open a screen and find
 * work in progress rather than a file where everything is finished. A pipeline that stops because
 * it FAILED and one that stops because it was told to look identical in the data — and the
 * existing seeder already prints `(stopped early, see errors)` for the first kind. Declaring the
 * plan is what makes the difference legible: the run asserts it produced exactly these, and the
 * spec asserts the plan itself names every stage with at least one chain per office.
 *
 * ⛔ These are DEMO DATA ONLY. Nothing here changes what a real install seeds.
 */

/**
 * The stages a demo chain may be halted at, in pipeline order.
 *
 * The order matters and is asserted: a stage list that drifted out of pipeline order would let a
 * later stage be seeded "before" an earlier one, and the report would read as nonsense.
 */
export const HALTED_STAGES = [
  /** An APPROVED needs assessment with no insurance programme built from it. */
  'needsAssessmentApproved',
  /** A FINALIZED programme that no opportunity was opened on. */
  'programmeFinalized',
  /** An opportunity sitting at `NEEDS_CONFIRMED` with no quote request. */
  'opportunityNeedsConfirmed',
  /**
   * An RFQ at `RFQ_ISSUED` sent to FEWER THAN THREE insurers, carrying an art. 15/d/5 exemption
   * marked «بلا إثبات» (decision 139), with an eligible inbound communication from that customer
   * waiting to be attached to it.
   */
  'rfqIssuedAwaitingEvidence',
] as const;

export type HaltedStage = (typeof HALTED_STAGES)[number];

/**
 * How many chains halt at each stage, PER OFFICE.
 *
 * Small and fixed. The point is that a presenter can find one, not that the file looks busy —
 * and every chain here is a chain that does NOT become a policy, so a large number would quietly
 * empty the dashboards item 5 exists to fill.
 */
export const HALTED_CHAINS_PER_OFFICE: Readonly<Record<HaltedStage, number>> = {
  needsAssessmentApproved: 2,
  programmeFinalized: 2,
  opportunityNeedsConfirmed: 2,
  rfqIssuedAwaitingEvidence: 2,
};

/** Every stage, expanded one entry per chain, in pipeline order. */
export function haltedChainSchedule(): HaltedStage[] {
  return HALTED_STAGES.flatMap((stage) =>
    Array.from({ length: HALTED_CHAINS_PER_OFFICE[stage] }, () => stage),
  );
}

/** How many customers a single office's halted chains consume. */
export function haltedChainCount(): number {
  return HALTED_STAGES.reduce(
    (total, stage) => total + HALTED_CHAINS_PER_OFFICE[stage],
    0,
  );
}

/**
 * 🔴 THE TWO DEMO OFFICES' NAMES — OWNER DECISION 150 RULING 6, annex §٦.
 *
 * ⛔ SLICED from `docs/decision-150-ratified-strings.md` and never invented. Her own note under
 * that table: *«الاسمان الإنجليزيان كلمات الإدارة … والأسماء الأربعة من اختراعها، لا أسماء مكاتب
 * قائمة»* — they are hers, and they name no real brokerage.
 *
 * `demo-chain-plan.spec.ts` re-slices all four out of that file at test time and compares byte
 * for byte, so a copy here that drifts from her table fails by name. ⛔ A test holding its own
 * copy of her Arabic would be a second home for it.
 *
 * ⛔ DEMO DATA ONLY. `packages/db/prisma/seed.ts` is untouched: a real install still gets its own
 * default office name, and renaming offices for a demonstration must not reach a real one.
 */
export const DEMO_OFFICE_NAMES: Readonly<
  Record<'office-a' | 'office-b', { ar: string; en: string }>
> = {
  'office-a': { ar: 'مكتب ناصر للتأمينات', en: 'Nasser Insurance Office' },
  'office-b': { ar: 'مكتب الحياة للتأمينات', en: 'Al-Hayat Insurance Office' },
};
