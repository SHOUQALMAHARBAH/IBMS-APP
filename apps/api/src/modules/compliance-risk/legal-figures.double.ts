import { Prisma } from '@ibms/db';
import type { LicenceLegalFigures } from './legal-figures.config';
import type { LegalValueService } from './legal-value.service';

/**
 * THE INSTRUMENT'S OWN FIGURES, as the seed writes them — for specs about something else.
 *
 * `legal-figures.config.spec.ts` builds its figures from fabricated `LegalValue` ROWS, because its
 * subject is the loading rule. Every other spec's subject is a licence rule, and those need the
 * figures to be *the real ones* without caring how they got there.
 *
 * ## WHY THIS IS SHARED RATHER THAN WRITTEN PER SPEC — the `license-gate.double.ts` lesson again
 *
 * A hand-written `{ renewalApplicationDueDaysBeforeExpiry: 45, ... }` in each of six specs would be
 * six copies of art. 4/a and art. 11, which is exactly what OWNER DECISION 123 removed from
 * `apps/api/src`. Worse, they would be six copies that cannot be wrong in the same way at the same
 * time: one spec left at a stale figure would go on passing against a product that had moved.
 *
 * So the figures have ONE home in test code, and `legal-values-parity.spec.ts` in `packages/db`
 * pins the catalogue's own figures against the seed. If the instrument's figures ever move, a
 * migration appends new rows and THIS file is the one place a spec's expectation changes.
 */
export const INSTRUMENT_LICENCE_FIGURES: LicenceLegalFigures = {
  // Art. 11, printed page 15.
  renewalApplicationDueDaysBeforeExpiry: 45,
  // Art. 14/c, printed page 16.
  article14cSuspensionLimitYears: 2,
  /*
   * Art. 4/a, printed page 5. SIX and TWELVE are the boundaries and 7,500 is the middle amount —
   * the OCR extraction publishes 5 and 7,000 for two of these and marks them trusted, so a spec
   * that copied from that file would be green against the wrong law.
   */
  capitalBands: [
    { upToBranches: 6, requiredJod: new Prisma.Decimal('5000') },
    { upToBranches: 12, requiredJod: new Prisma.Decimal('7500') },
    {
      upToBranches: Number.POSITIVE_INFINITY,
      requiredJod: new Prisma.Decimal('10000'),
    },
  ],
};

/** A `LegalValueService` answering with the instrument's own figures, for a service spec whose
 *  subject is not the legal-values table. */
export function instrumentLegalValues(): LegalValueService {
  // `Promise.resolve` rather than `async () =>`: an async arrow with no `await` is a
  // `require-await` lint error, and the double's whole job is to answer without doing anything.
  return {
    licenceFigures: () => Promise.resolve(INSTRUMENT_LICENCE_FIGURES),
    findInForce: () => Promise.resolve(null),
    listInForce: () => Promise.resolve([]),
    history: () => Promise.resolve([]),
    declare: () =>
      Promise.reject(
        new Error(
          'instrumentLegalValues() is a READ double. A spec that declares a value wants the real ' +
            'service and a database — see legal-value.e2e-spec.ts.',
        ),
      ),
  } as unknown as LegalValueService;
}
