import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 🔴 THE ARABIC NAME OF A COUNTRY CODE, SENT WITH THE RECORD — contents §ج row ٢٠.
 *
 * The customer file printed the nationality as the stored code, «JO», on a screen whose other
 * half is Arabic. The Arabic name is in the provider's own `Country` reference table and the
 * screen could not reach it.
 *
 * ## Why the server resolves it rather than the screen, and this is MEASURED
 *
 * The eight reference lists are served by `GET /reference-data`, gated on
 * **`provider.office.register`** — a PROVIDER capability, held by nobody who reads a customer
 * file. So a customer screen that resolved the country name from that route would 403 for every
 * ordinary reader. ⛔ And the answer is not to widen that gate or grant anybody a code: the
 * standing rule is that no role is granted a permission to make a screen work.
 *
 * Sending the name with the record reveals nothing new — the caller is already reading the
 * customer whose nationality it is. This is the identical shape `insurance-line-names.ts` arrived
 * at when `GET /insurance-lines` turned out not to admit `policy.read`.
 *
 * ## ⚠️ AND THE TABLE HOLDS ONE ROW, MEASURED — SO MOST CODES HAVE NO ARABIC NAME
 *
 * Dev, 2026-11-25: `Country` holds exactly **one** row, `JO` / Jordan / «الأردن». `nationality`
 * is a free two-letter code typed into a text input (`CustomerOnboardingWizard`), with no picker
 * and no FK, so any other code resolves to `null` — which the screen renders as the code it
 * stored. ⛔ That is an EMPTY CELL and not a cue to invent a name: translating a country is the
 * provider's row to add, not this file's.
 *
 * `ReferenceDataService` reads the same table for the registration pickers. This is a SECOND
 * reader of one table and not a second answer to one question: it returns the stored `nameAr`
 * verbatim, with no precedence and no fallback of its own.
 */
@Injectable()
export class CountryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The Arabic name for one country code, or null when the table does not carry it.
   *
   * ⚠️ A blank or whitespace-only name is treated as ABSENT rather than passed through — the rule
   * `insuranceLineNameAr` and `preferLanguage` both follow, because an empty string renders as
   * nothing at all and nobody is told (decision 148's own defect).
   *
   * ⚠️ The lookup is case-insensitive on purpose. `nationality` is free text that both write
   * paths upper-case at the boundary (`CustomerOnboardingWizard`, `CustomerIdentifierCorrection`),
   * but the column has no constraint saying so, and a legacy-imported row is whatever the office's
   * old system held. Matching exactly would silently drop the name for a lower-case row.
   */
  async nameArForCode(code: string | null): Promise<string | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;
    const row = await this.prisma.client.country.findFirst({
      where: { code: { equals: trimmed, mode: 'insensitive' } },
      select: { nameAr: true },
    });
    const ar = row?.nameAr?.trim();
    return ar ? ar : null;
  }
}
