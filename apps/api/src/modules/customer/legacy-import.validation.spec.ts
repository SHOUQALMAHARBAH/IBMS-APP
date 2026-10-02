import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_IMPORT_UNVALIDATABLE_FIELDS,
  legacyRowAsDto,
  validateLegacyRow,
} from './legacy-import.validation';
import type { LegacyImportRow } from './legacy-import.config';

/**
 * THE EXCLUSION SET IS PINNED, because a list nothing reads is a list that rots.
 *
 * Five fields of the intake DTO are suppressed when a legacy row is validated against it — because
 * the format has no column for them or the import does not require them, and the whole arrangement only
 * stays "one source of truth" if the set cannot grow without somebody noticing.
 *
 * The assertion that matters most is the NEGATIVE one: `registrationNumber` must never enter this set.
 * It would qualify under the same reasoning as `contactPhone` — a column exists and the import does not
 * require it — and excluding it would silently reopen the measured hole: a corporate row with no number
 * imports cleanly and the partial unique then tolerates it as UNKEYED.
 */
const CORPORATE: LegacyImportRow = {
  lineNumber: 2,
  legalName: 'Yarmouk Trading',
  customerType: 'CORPORATE',
  registrationNumber: 'REG-1',
};

const INDIVIDUAL: LegacyImportRow = {
  lineNumber: 3,
  legalName: 'آية ناصر عادل الخوالدة',
  customerType: 'INDIVIDUAL',
  nationality: 'JO',
};

describe('legacy row validated against the intake DTO', () => {
  it('suppresses exactly five fields, and NEVER the registration number', () => {
    expect([...LEGACY_IMPORT_UNVALIDATABLE_FIELDS].sort()).toEqual([
      'contactEmail',
      'contactPhone',
      'nationalId',
      'natureOfBusiness',
      'registeredAddress',
    ]);
    // The negative, stated separately rather than left to the list above: this is the one that would
    // reopen the hole, and an exact-set assertion alone would not say why it matters.
    expect(
      [...LEGACY_IMPORT_UNVALIDATABLE_FIELDS] as string[],
      'the registration number is the KEY — excluding it reopens the duplicate hole',
    ).not.toContain('registrationNumber');
  });

  it('accepts a complete corporate row and a complete individual row', () => {
    // The positive witness. Without it every assertion below passes on a validator that refuses
    // everything, which is the failure mode this file is most at risk of.
    expect(validateLegacyRow(CORPORATE)).toEqual([]);
    expect(validateLegacyRow(INDIVIDUAL)).toEqual([]);
  });

  it('REFUSES a corporate row with no registration number — the measured hole', () => {
    const problems = validateLegacyRow({
      ...CORPORATE,
      registrationNumber: undefined,
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('registrationNumber');
  });

  it('refuses a row with an empty name, which the parser no longer checks', () => {
    // The hand-rolled "legalName is empty" check was DELETED from `mapRows`; the DTO is what refuses it
    // now. If this fails, the deletion removed a rule rather than relocating it.
    const problems = validateLegacyRow({ ...CORPORATE, legalName: '' });
    expect(problems.length).toBeGreaterThan(0);
  });

  it('applies the ISO nationality rule, which the import never used to reach', () => {
    const problems = validateLegacyRow({
      ...INDIVIDUAL,
      nationality: 'Jordan',
    });
    expect(problems.join(' ')).toContain('ISO 3166-1');
  });

  it('splits an individual name into parts that rejoin to the ORIGINAL string', () => {
    // The DTO computes `legalName` from the four parts and refuses a directly-supplied one, so the
    // import's single name column is split on the first space. `composeFullName` rejoins with a single
    // space, so the stored name must be byte-identical to what the file carried — otherwise the import
    // would quietly rewrite customers' names.
    const dto = legacyRowAsDto(INDIVIDUAL) as {
      givenName: string;
      familyName: string;
    };
    expect(`${dto.givenName} ${dto.familyName}`).toBe(INDIVIDUAL.legalName);
  });

  it('never sends a fabricated natureOfBusiness', () => {
    // An earlier draft supplied a placeholder string to satisfy the validator, which would have written
    // a FABRICATED business nature into the customer record. A fabricated value is worse than an
    // unvalidated field.
    const dto = legacyRowAsDto(CORPORATE);
    expect(dto).not.toHaveProperty('natureOfBusiness');
  });
});
