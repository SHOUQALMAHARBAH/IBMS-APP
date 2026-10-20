/**
 * ONE HOME FOR THE MINIMUM LENGTH OF A DECLARATION'S WRITTEN REASON.
 *
 * ## Why this file exists rather than a second `10`
 *
 * The owner's instruction when the no-floor retention declaration was decided: *"follow the
 * EXISTING minimum reason length rather than inventing one — measure what that window uses and
 * match it. Two different minimums for one concept is the drift we keep paying for."*
 *
 * MEASURED across every reason-bearing field in the api: the DECLARATION shape — a reason attached
 * to an act somebody acknowledges — uses **ten** in both of its homes, `COMBINED_DUTY_REASON_MIN_LENGTH`
 * and the commission override's `reason`. The three-character minimums belong to a different shape
 * (dismissing a cross-sell or an up-sell recommendation, cancelling an endorsement), where the
 * reason is a note rather than a declaration.
 *
 * So matching it by writing `10` a third time would have satisfied the letter of that instruction
 * and broken its point. This constant is the number; `COMBINED_DUTY_REASON_MIN_LENGTH` now reads
 * from it, which keeps its three existing importers working untouched.
 *
 * ## Why it is in `common/` and not imported from the duty-segregation service
 *
 * `retention-floors.config.ts` is a PURE config with no service dependencies, read by a unit spec.
 * Importing the constant from `duty-segregation.service.ts` would drag four repositories and a
 * Nest-injectable into that import graph for the sake of one integer. A bare module costs nothing
 * and cannot cycle.
 */
export const DECLARATION_REASON_MIN_LENGTH = 10;
