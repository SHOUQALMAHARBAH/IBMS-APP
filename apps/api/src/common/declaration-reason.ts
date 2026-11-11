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
 * ## ✅ THE OPEN FIGURE IS CLOSED AT TEN — the owner, 11 November 2026
 *
 * This paragraph read: *one figure is open and is the owner's — the legal adviser's drafted window
 * for art. 15/d asks for a minimum of 15, against the ten here.* It was reported and deliberately
 * not changed, because which number one concept holds is a decision rather than a measurement.
 *
 * **It was put to her twice, and the second asking is the one that counts.** The first framed 15 as
 * the adviser's suggestion and she kept 10. That framing was incomplete: **fifteen was already a
 * recorded decision — decision 87, «وحقلُ المبرِّر خمسةَ عشرَ حرفاً حدّاً أدنى»** — and her standing
 * rule is that an older decision stands until she strikes it KNOWING it is one. So it was asked
 * again, with that said plainly. Her words: **«خليها 10 عادي ما بتضر»**.
 *
 * ⟶ **TEN IS THE FLOOR EVERYWHERE, and decision 87 is STRUCK on this point only** — the rest of
 * decision 87 stands. `docs/decision-129-exemption-tagged-by-the-system-chosen-only-when-unknown.md`
 * §5 carries her answer verbatim and is its one home. **No code changed: it was already ten.**
 *
 * The adviser's own drafted windows still SAY «حد أدنى 15 حرفاً» in `docs/answers/`, and they are
 * source transcriptions — reported, never corrected in place. A window built from them ships his
 * sentence and this file's floor, and the two now disagree by his number rather than by ours.
 *
 * (`check:legal-numbers` declares this constant in `NOT_A_LEGAL_NUMBER` for exactly this reason:
 * the citation above is a REPORT about a different figure, and no instrument states ten.)
 *
 * ## Why it is in `common/` and not imported from the duty-segregation service
 *
 * `retention-floors.config.ts` is a PURE config with no service dependencies, read by a unit spec.
 * Importing the constant from `duty-segregation.service.ts` would drag four repositories and a
 * Nest-injectable into that import graph for the sake of one integer. A bare module costs nothing
 * and cannot cycle.
 */
export const DECLARATION_REASON_MIN_LENGTH = 10;
