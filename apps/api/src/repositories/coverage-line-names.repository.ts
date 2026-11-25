import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { catalogueLineCodeForCoverageLine } from '../modules/insurance-program/insurance-program.config';

/**
 * 🔴 THE ARABIC NAME OF A RECOMMENDED COVERAGE LINE — contents §ج row ٢١.
 *
 * `/needs-assessments/[id]`'s «التغطية الموصى بها» printed the derived English strings
 * («Property All Risks (Fire)», «Group Medical») on a screen whose every other word is Arabic,
 * while the programme and the quote request both show their line in Arabic.
 *
 * ## ⚠️ AND IT IS NOT THE INSURANCE-LINE CATALOGUE'S VOCABULARY, WHICH IS THE WHOLE DIFFICULTY
 *
 * `NeedsAssessment.recommendedCoverageLines` holds values from `COVERAGE_LINES` — thirteen
 * canonical strings derived by `deriveRecommendedCoverageLines` — and **7 of the 13 differ from
 * the catalogue's `nameEn` deliberately**. `needs-assessment.config.ts`'s header records that the
 * owner CANCELLED the rename that would have aligned them, on measurement: it would have dropped
 * 90 of 90 approved dev assessments into `lineCode: null` and collapsed a fleet into a
 * comprehensive private motor policy.
 *
 * ⟶ So the Arabic name cannot be looked up by the stored string. It is resolved through the
 *   bridge that ALREADY pairs the two vocabularies — `COVERAGE_LINE_MAPPINGS` — and ⛔ no second
 *   copy of that pairing is written here.
 *
 * ## Why the server resolves it rather than the screen
 *
 * The same reason as the policy's line, measured in message 45 §2: `GET /insurance-lines` is
 * gated on five permissions and `needs-assessment.read` is not among them. ⛔ Widening that gate
 * or granting a code to make a screen work is not available.
 *
 * ## Why this is a repository rather than a config helper
 *
 * `insurance-program.config.ts` already imports from `needs-assessment.config.ts`, so resolving
 * this inside the needs-assessment config would close a cycle. Repositories are the layer this
 * codebase shares across modules (services are never shared), and a repository importing a
 * module's pure config is established — `comparison.repository.ts` imports `ComparisonRowPlan`
 * the same way.
 *
 * ## ⚠️ ONE QUERY FOR THE WHOLE LIST, NEVER ONE PER LINE
 *
 * Thirteen is the maximum and a typical assessment recommends a handful, but a per-line query is
 * the N+1 shape message 51 §5 recorded for `displayNameForUserId` — so this takes the whole list
 * and answers with a map.
 */
@Injectable()
export class CoverageLineNamesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Arabic name per coverage-line string, for the lines that have one.
   *
   * A line absent from the returned map has NO known Arabic name, and the screen shows the
   * English string it stored. Two ways that happens, both honest:
   *
   *   - the coverage line is in no mapping (nothing pairs it with a catalogue line), or
   *   - the catalogue row carries no `nameAr`.
   *
   * ⛔ Neither is a cue to invent one. ⚠️ A blank or whitespace-only `nameAr` counts as ABSENT,
   * the rule `insuranceLineNameAr` and `preferLanguage` both follow — an empty string renders as
   * nothing at all and nobody is told (decision 148's own defect).
   */
  async namesArFor(
    coverageLines: readonly string[],
  ): Promise<Record<string, string>> {
    const codeByLine = new Map<string, string>();
    for (const line of coverageLines) {
      const code = catalogueLineCodeForCoverageLine(line);
      if (code) codeByLine.set(line, code);
    }
    if (codeByLine.size === 0) return {};

    const rows = await this.prisma.client.insuranceLine.findMany({
      where: { code: { in: [...new Set(codeByLine.values())] } },
      select: { code: true, nameAr: true },
    });
    const arByCode = new Map<string, string>();
    for (const r of rows) {
      const ar = r.nameAr?.trim();
      if (ar) arByCode.set(r.code, ar);
    }

    const out: Record<string, string> = {};
    for (const [line, code] of codeByLine) {
      const ar = arByCode.get(code);
      if (ar) out[line] = ar;
    }
    return out;
  }
}
