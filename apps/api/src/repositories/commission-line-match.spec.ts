import { describe, expect, it } from 'vitest';
import { agreementLineMatch } from './commission.repository';

/**
 * The line predicate that decides which commission agreement governs a Policy.
 *
 * Tested as a pure function because it is where the money crossing is decided, and because the
 * three branches are easy to get wrong in a way no integration test would isolate: identity-only,
 * identity-plus-legacy, and string-only.
 */
describe('agreementLineMatch', () => {
  it('matches on the managed line ID when the policy has one', () => {
    const where = agreementLineMatch({
      insuranceLineId: 'line-1',
      officeInsuranceLineId: null,
      insuranceLine: 'Property All Risks',
    });
    // An OR, because of the transitional clause — but the FIRST arm is pure identity.
    expect(where.OR?.[0]).toEqual({ insuranceLineId: 'line-1' });
  });

  it('never matches an agreement whose identity DIFFERS, even if the strings agree', () => {
    // The property the string match could not give: two rows naming the same words are not the
    // same line unless they carry the same id. The transitional arm is guarded on BOTH FKs being
    // null, so an agreement with a different line id cannot satisfy it.
    const where = agreementLineMatch({
      insuranceLineId: 'line-1',
      officeInsuranceLineId: null,
      insuranceLine: 'Property All Risks',
    });
    const legacy = where.OR?.[1] as { AND: Record<string, unknown>[] };
    expect(legacy.AND).toContainEqual({ insuranceLineId: null });
    expect(legacy.AND).toContainEqual({ officeInsuranceLineId: null });
  });

  it("uses the office line id when that is the policy's identity", () => {
    const where = agreementLineMatch({
      insuranceLineId: null,
      officeInsuranceLineId: 'office-line-9',
      insuranceLine: 'Drone Hull',
    });
    expect(where.OR?.[0]).toEqual({ officeInsuranceLineId: 'office-line-9' });
  });

  it('falls back to the STRING only when the policy has no identity at all', () => {
    // The 632 parked policies and anything written before the writers were fixed. There is
    // nothing else such a row can be matched on, so the old behaviour is preserved exactly —
    // including the case-insensitive trim, which is correct for free text even though it was
    // wrong as a primary key.
    const where = agreementLineMatch({
      insuranceLineId: null,
      officeInsuranceLineId: null,
      insuranceLine: '  motor  ',
    });
    expect(where.OR).toBeUndefined();
    expect(where.insuranceLine).toEqual({
      equals: 'motor',
      mode: 'insensitive',
    });
  });
});
