/**
 * 🔴 THE ARABIC NAME OF A *GROUP*, AND WHY IT IS NOT SIMPLY THE FIRST ROW'S.
 *
 * Owner's demo-path contents §أ row ١١ — the insurer and line names on the claims dashboard, the
 * financial dashboard, the financial report and `/insurer-accounting` printed in English
 * («Public Liability», «Middle East Insurance Company (demo)») while the Arabic names sat on the
 * records. Every one of those surfaces is an AGGREGATE: it groups rows and prints one label per
 * group, so the Arabic name has to be a property of the GROUP rather than of a row.
 *
 * ## The two shapes of group key, and only one of them answers for itself
 *
 * 1. **The key IS the entity** — `insurerId`. Every row in the group is the same insurer, so
 *    every row carries the same Arabic name and any of them answers. No ambiguity exists.
 *
 * 2. **The key is a STORED STRING** — `Policy.insuranceLine`, the English line name the policy
 *    recorded. The Arabic name does NOT come from that string: it comes from the line FK
 *    (`insuranceLineId` / `officeInsuranceLineId`) through `insuranceLineNameAr`. So two rows
 *    sharing one stored string may point at different catalogue rows, or one may carry no FK at
 *    all — and then "the group's Arabic name" is a question with more than one answer.
 *
 * ⛔ SO THE FIRST ROW'S NAME IS NOT USED, and that is a correctness choice rather than a tidiness
 *   one. The analytics queries read `orderBy: { createdAt: 'asc' }` with a `take` cap, so "the
 *   first row" is whatever the planner's window happened to start with — the under-specified
 *   selection shape that took a CI run red in message 48 §3, where a fixture read `take: 40`
 *   with no `where` and the test passed or failed on the window. A label that changes when an
 *   unrelated policy is written is worse than an English label that never does.
 *
 * ## The rule: the names PRESENT must be unanimous, and absence is not a disagreement
 *
 * A row carrying no Arabic name is not asserting that the line has none — `insuranceLineNameAr`
 * returns `null` for "no Arabic name is KNOWN for this row", which is exactly what an
 * unmigrated FK looks like. It abstains; it does not vote. So:
 *
 *   - exactly ONE distinct Arabic name among the rows that have one  ⟶ that name
 *   - none at all                                                   ⟶ `null`
 *   - two or more that differ                                       ⟶ `null`
 *
 * and `null` means the screen renders the group key, which is the stored English string — the one
 * label that is true of every row in the group by construction. ⛔ No Arabic name is invented and
 * none is picked from a row to stand for rows it does not describe.
 *
 * ## Measured, so the third branch is a guard and not a fear
 *
 * Dev, 2026-11-25, every written policy grouped by its stored `insuranceLine` string against the
 * Arabic name its FK resolves to: **5 groups, each resolving to exactly ONE Arabic name, and
 * zero rows with no Arabic name at all.** db-test holds no policies. So today every group takes
 * branch one — and the two `null` branches exist because the FK is nullable in the schema, which
 * is a property of the database rather than of this week's data.
 *
 * ⚠️ A blank or whitespace-only name is treated as ABSENT, matching `insuranceLineNameAr` and
 * `preferLanguage`: an empty string renders as nothing at all, which is the silent blank-cell
 * shape decision 148 was written about.
 */
export function unanimousGroupName(
  names: readonly (string | null | undefined)[],
): string | null {
  const present = new Set<string>();
  for (const n of names) {
    const trimmed = n?.trim();
    if (trimmed) present.add(trimmed);
  }
  if (present.size !== 1) return null;
  return [...present][0];
}
