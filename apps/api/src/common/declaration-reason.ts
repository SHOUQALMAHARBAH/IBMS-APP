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
 * ## OWNER DECISION 126 MAKES THIS THE FLOOR OF A GENERAL MACHINE, NOT OF TWO WINDOWS
 *
 * Decision 126 (2026-10-19, confirmed 2026-11-10): the system WARNS AND RECORDS AND DOES NOT
 * REFUSE. A non-compliant act proceeds behind a window carrying the article's own text, a written
 * reason and a hand-ticked acknowledgement, and the regulatory responsibility is the office's — and
 * only four acts are refused outright, each one whose harm cannot be undone and falls on someone
 * OTHER than the office. **That machine has SEVEN sites**, so it is built once and general; this
 * constant is the floor every one of them will share, which is why a third literal `10` must not
 * appear when it is built. See `docs/decision-126-declare-and-record-refuse-only-the-irreversible.md`.
 *
 * ⚠️ AND ONE FIGURE IS OPEN AND IS THE OWNER'S: the legal adviser's drafted window for art. 15/d
 * asks for a minimum of **15**, against the ten here. Reported and deliberately NOT changed — one
 * concept with one minimum is this file's whole purpose, and which number it holds is a decision
 * rather than a measurement. (`check:legal-numbers` declares this constant in `NOT_A_LEGAL_NUMBER`
 * for exactly this reason: the citation above is a REPORT about a different figure, and no
 * instrument states ten.)
 *
 * ## Why it is in `common/` and not imported from the duty-segregation service
 *
 * `retention-floors.config.ts` is a PURE config with no service dependencies, read by a unit spec.
 * Importing the constant from `duty-segregation.service.ts` would drag four repositories and a
 * Nest-injectable into that import graph for the sake of one integer. A bare module costs nothing
 * and cannot cycle.
 */
export const DECLARATION_REASON_MIN_LENGTH = 10;
