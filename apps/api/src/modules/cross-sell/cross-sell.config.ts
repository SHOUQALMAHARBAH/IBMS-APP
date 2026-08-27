/**
 * Process 8 — Cross-Selling (backlog Part C #8, Domain A). The benchmark
 * line list every established commercial customer is expected to carry, and
 * the pure comparison that turns "held lines" + "benchmark" into the set of
 * gap lines.
 *
 * Same philosophy as needs-assessment.config.ts / risk-profile.config.ts /
 * insurance-program.config.ts: `findCoverageGaps()` is pure and
 * deterministic, so the same inputs always produce the same gaps and a
 * reviewer can reason about why a customer was (or was not) flagged.
 *
 * ONE conservative global list, deliberately not a per-sector table: the
 * schema has no structured sector/activity taxonomy on `Customer`
 * (`natureOfBusiness` is free text; `Prospect.sector` is a different model
 * and not always present), so a sector-specific benchmark has nothing
 * reliable to key off yet. A per-sector benchmark is a documented deferred
 * edge (README § Known gaps, Part C #8).
 *
 * The vocabulary matches `InsuranceProgramLine.insuranceLine` /
 * insurance-program.config.ts so a held `Policy.insuranceLine` and a
 * benchmark entry compare like-for-like. `Policy.insuranceLine` is
 * free-text (the Policy module, Domain B, is not built), so the comparison
 * is case- and whitespace-insensitive rather than exact.
 */

/** The lines a commercial customer is expected to hold. Kept small and
 * defensible — the four every established commercial business typically
 * carries — rather than an aspirational full list that would flag every
 * customer for everything. */
export const BENCHMARK_LINES: readonly string[] = [
  'Property All Risks',
  'Business Interruption',
  'Public Liability',
  'Workers Compensation',
];

/** Case-fold + collapse internal whitespace, so "public liability" and
 * "Public  Liability" match the benchmark entry "Public Liability". */
function normalise(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The benchmark lines a customer holds no in-force policy for, returned in
 * `BENCHMARK_LINES` declaration order. Pure and deterministic. A held line
 * that is not in the benchmark (e.g. "Motor Fleet") is simply ignored — it
 * is not a gap and it does not suppress one.
 */
export function findCoverageGaps(
  heldLines: readonly string[],
  benchmark: readonly string[] = BENCHMARK_LINES,
): string[] {
  const held = new Set(heldLines.map(normalise));
  return benchmark.filter((line) => !held.has(normalise(line)));
}
