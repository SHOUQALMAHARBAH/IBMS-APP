import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MODULE 0-ب — THE EIGHT PROVIDER-MAINTAINED LISTS, READ BY THE SCREENS THAT HAVE TO OFFER THEM.
 *
 * Item (c) seeded eight reference tables and nothing could read them, which is § 1.44's shape: a
 * registration form cannot ask for a legal form, a licensing authority, a country, a city or a bank
 * without the list, so without this route item (d)'s capability would exist and be unreachable by
 * clicking — the defect this repository has measured 33 times.
 *
 * ## WHY ONE ROUTE AND NOT EIGHT
 *
 * The registration screen needs ALL of them to render its first frame. Eight requests would mean
 * eight loading states on one form and eight ways for it to half-arrive; a screen that can show its
 * country picker but not its bank picker is worse than one that waits. They are also small and
 * static — 43 rows across all eight, measured — so there is nothing to paginate and nothing to
 * filter.
 *
 * ## WHY NO `InsuranceLine`
 *
 * The 32-line catalogue is NOT one of these. It already has `GET /insurance-lines`, gated on
 * `insurer.read`, and an office's own additions appear beside the standard list there. Serving it a
 * second time here would be a second answer to "what lines exist", and the two would drift the first
 * time one of them learned about office-added lines.
 */
@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All eight, in `displayOrder` then name — a stable order, so a picker does not reorder itself
   * between renders and the provider's own ordering (JOD first in the currency list, Jordan first in
   * the countries) survives to the screen.
   *
   * THERE IS NO `isActive` ON THESE TABLES, which the compiler is what told me: the first version of
   * this file carried a paragraph explaining how retired rows are handled, and no such column exists.
   * Retiring a reference row is therefore not expressible today — recorded in
   * `docs/deferred-register.md` rather than invented here, because the question it raises (what
   * happens to an office whose stored legal form is retired) is a decision, not a column.
   */
  async all() {
    const order = {
      orderBy: [{ displayOrder: 'asc' as const }, { nameEn: 'asc' as const }],
    };
    const [
      countries,
      cities,
      banks,
      currencies,
      licensingAuthorities,
      ratingAgencies,
      legalForms,
      businessModels,
    ] = await Promise.all([
      this.prisma.client.country.findMany(order),
      this.prisma.client.city.findMany(order),
      this.prisma.client.bank.findMany(order),
      this.prisma.client.currency.findMany(order),
      this.prisma.client.licensingAuthority.findMany(order),
      this.prisma.client.ratingAgency.findMany(order),
      this.prisma.client.legalForm.findMany(order),
      this.prisma.client.businessModel.findMany(order),
    ]);

    const view = (rows: ReferenceRow[]) =>
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        /*
         * The Arabic description. PRESENT ON ALL EIGHT since migration
         * `20261130100000_value_descriptions`, which gave each list its own
         * `*_description_required` CHECK.
         *
         * It was legal forms and business models alone under item (c), in the owner's words: a city,
         * a bank and a country are satisfied by their Arabic NAME. She reversed that on 2026-10-15
         * with a rule pointing the other way — where a value carries NO consequence the description
         * SAYS so, because a person who believes his choice changes the system's behaviour and later
         * finds it does not stops trusting every list after it. So three of the eight now carry a
         * disclaiming line rather than no line, which `reference-tables.spec.ts` enforces.
         *
         * The `in` test stays: it is what makes this view total over eight models whose only shared
         * shape is structural, and removing it would make a list added later fail at runtime rather
         * than render without a description.
         */
        descriptionAr: 'descriptionAr' in r ? (r.descriptionAr ?? null) : null,
      }));

    return {
      countries: view(countries),
      cities: view(cities),
      banks: view(banks),
      currencies: view(currencies),
      licensingAuthorities: view(licensingAuthorities),
      ratingAgencies: view(ratingAgencies),
      legalForms: view(legalForms),
      businessModels: view(businessModels),
    };
  }
}

interface ReferenceRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionAr?: string | null;
}
