import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import type { LegacyImportRow } from './legacy-import.config';

/**
 * A LEGACY ROW, VALIDATED AGAINST THE INTAKE DTO — one source of truth for the rules.
 *
 * ## What this replaces
 *
 * `mapRows` hand-rolled two checks — "legalName is empty" and "customerType must be INDIVIDUAL or
 * CORPORATE" — and nothing else. The intake DTO expresses both and a dozen more, and the gap between
 * the two copies was MEASURED rather than feared: the field-shape rule had been copied across and the
 * required-field rule had not, so **a corporate row with no registration number imported cleanly**, and
 * the partial unique added in migration 20261107100000 then tolerates it as UNKEYED. The 2,000-row path
 * could create rows the key cannot protect — a hole in the guarantee, in the path that goes first.
 *
 * The two hand-rolled checks are DELETED, not left beside this. A fix that adds a rule to a copy leaves
 * the structure that produced the drift.
 *
 * ## The validators run outside the request path — measured, not assumed
 *
 * `plainToInstance` + `validateSync` with the global pipe's own options. Probed before committing to the
 * approach, because the answer turns on whether any validator reaches for request context:
 *
 *   * every validator on `CreateCustomerDto` reads the OBJECT only;
 *   * `CustomerTypeFieldCoherence`, a custom `ValidatorConstraint` and the one most likely to need
 *     context, reads `args.object` and fires correctly standalone;
 *   * `@Transform(emptyStringToUndefined)` applies, because `plainToInstance` is what the pipe calls;
 *   * `forbidNonWhitelisted` fires on an unknown key.
 *
 * So the import gets the same rules producing the same answers, with the validators' own messages.
 *
 * ## FIVE FIELDS THE IMPORT CANNOT REQUIRE — and the one it DOES
 *
 * `LEGACY_IMPORT_FIELDS` is `legalName, customerType, registrationNumber, nationality, contactEmail,
 * contactPhone, registeredAddress`, and `LEGACY_IMPORT_REQUIRED_FIELDS` is only `legalName` and
 * `customerType` — so a real export may map very little of it. The DTO requires more than that, for
 * two different reasons, and the distinction is worth keeping:
 *
 * NO COLUMN EXISTS for it in the format:
 *
 *   `nationalId`    required for an INDIVIDUAL. A legacy file has no column for it and inventing one
 *                   is out of the question. `Customer.nationalIdEnc` is nullable precisely for these
 *                   rows.
 *
 * A COLUMN EXISTS but the import's own contract does not require it, so a file that does not map it is
 * a legitimate file rather than a bad one:
 *
 *   `contactPhone`      required at intake, not required by the import.
 *   `contactEmail`      the same.
 *   `registeredAddress` the same. Refusing every corporate row whose export lacks an address column
 *                   would be a behaviour change far beyond closing the duplicate hole, and unrelated
 *                   to it.
 *   `natureOfBusiness`  required for a CORPORATE record at intake and absent from the format. The
 *                   first draft of this file supplied a placeholder string instead — which would have
 *                   written a FABRICATED business nature into the customer record, and a fabricated
 *                   value is worse than an unvalidated field. Excluded, like the other three, because
 *                   it is genuinely absent rather than derivable.
 *
 * **AND `registrationNumber` IS DELIBERATELY NOT IN THIS LIST**, though it would qualify under the
 * second reason — the format has a column and the import does not require it. It is required here
 * because it IS THE KEY: the partial unique added in migration 20261107100000 is what protects a
 * company from being imported twice, and a row without it is a row the key cannot protect. That single
 * exception is the whole point of this file, so it is stated rather than left to be inferred from the
 * list's absence.
 *
 * The set is **named here, in one place, and pinned by a test** — so a SIXTH cannot be added silently,
 * and in particular so the registration number cannot drift into it. Adding to this set is a reviewed
 * change; everything else the DTO says still applies.
 *
 * What is NOT excluded, because it is derivable rather than absent: the four INDIVIDUAL name parts. The
 * DTO computes `legalName` from them and refuses a directly-supplied one, so a legacy row's single name
 * column is split the way the repo already splits one — on the first space, which `composeFullName`
 * rejoins byte-identically, so the stored name is unchanged.
 *
 * `languagePreference` is likewise not an exclusion: the import supplies `AR`, the schema default,
 * rather than inventing a preference the office never recorded. That is a value choice, not a
 * validation bypass.
 */
export const LEGACY_IMPORT_UNVALIDATABLE_FIELDS = [
  'nationalId',
  'contactPhone',
  'contactEmail',
  'natureOfBusiness',
  'registeredAddress',
] as const;

/** The pipe's own options, so the standalone run cannot drift from the request path. */
const PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
} as const;

/**
 * The DTO-shaped object a legacy row becomes.
 *
 * Exported for the test that pins the exclusion set: it builds a row, validates it, and asserts which
 * properties the exclusions actually suppress — a list nothing reads is a list that rots. FOUR fields
 * are suppressed and the test says four, so a fifth is a reviewed change.
 */
export function legacyRowAsDto(row: LegacyImportRow): Record<string, unknown> {
  if (row.customerType === 'INDIVIDUAL') {
    // On the FIRST space, matching `createIndividualCustomer` in the customer e2e: `composeFullName`
    // rejoins the parts with a single space, so the resulting `legalName` is byte-identical to the
    // string the file carried.
    const [givenName, ...rest] = row.legalName.split(' ');
    return {
      customerType: 'INDIVIDUAL',
      givenName,
      familyName: rest.join(' ') || givenName,
      nationality: row.nationality,
      languagePreference: 'AR',
    };
  }
  return {
    customerType: 'CORPORATE',
    legalName: row.legalName,
    registrationNumber: row.registrationNumber,
    registeredAddress: row.registeredAddress,
    // `natureOfBusiness` is deliberately NOT set: see the exclusion list. The import does not write it
    // either, so inventing one here to satisfy a validator would put a fabricated fact in the record.
    languagePreference: 'AR',
  };
}

/**
 * Every validation message for a legacy row, with the structurally-impossible fields suppressed.
 *
 * Returns an EMPTY array for a row the DTO accepts. The caller turns a non-empty result into a
 * `BAD_DATA` issue carrying these messages — the validators' own words, not a restatement.
 */
export function validateLegacyRow(row: LegacyImportRow): string[] {
  const dto = plainToInstance(CreateCustomerDto, legacyRowAsDto(row));
  const excluded = new Set<string>(LEGACY_IMPORT_UNVALIDATABLE_FIELDS);
  return validateSync(dto, PIPE_OPTIONS)
    .filter((error) => !excluded.has(error.property))
    .flatMap((error) => Object.values(error.constraints ?? {}));
}
