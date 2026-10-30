import { describe, expect, it } from 'vitest';
import {
  INSURANCE_COMPANY_LICENSE_STANDINGS,
  deriveCompanyLicenseStanding,
  pickCurrentCompanyTerm,
} from './insurance-company-license.config';

/**
 * THE COMPANY'S LICENCE STANDING — batch 5 group 7d.
 *
 * A pure function taking `now`, so every boundary is chosen rather than waited for. The broker side
 * learned this the hard way: three plants survived an e2e there because the single seeded office
 * could not express the distinguishing case, and the rule that came out of it was that a rule which
 * can only be exercised on data the test database does not have belongs in a pure function.
 */
describe('the standing is a CLOSED THREE', () => {
  it('and the third state is the one a careless version loses', () => {
    expect(INSURANCE_COMPANY_LICENSE_STANDINGS).toEqual([
      'NO_TERM_ON_RECORD',
      'CURRENT',
      'EXPIRED',
    ]);
  });
});

describe('deriveCompanyLicenseStanding', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');

  it('NO TERM ON RECORD is not EXPIRED — a missing fact about our records, not a finding', () => {
    const v = deriveCompanyLicenseStanding([], now);
    expect(v.standing).toBe('NO_TERM_ON_RECORD');
    expect(v.currentTerm).toBeNull();
    expect(v.termCount).toBe(0);
  });

  it('CURRENT while the expiry is in the future, and it carries the term it was derived from', () => {
    const v = deriveCompanyLicenseStanding(
      [
        {
          licenseNumber: 'IC-1',
          issuedAt: new Date('2024-01-01T00:00:00.000Z'),
          expiresAt: new Date('2027-12-31T00:00:00.000Z'),
        },
      ],
      now,
    );
    expect(v.standing).toBe('CURRENT');
    // The ARITHMETIC IS CHECKABLE from the response: a standing with no term behind it is an
    // assertion a reader has to take on trust.
    expect(v.currentTerm?.licenseNumber).toBe('IC-1');
    expect(v.currentTerm?.expiresAt).toBe('2027-12-31T00:00:00.000Z');
    expect(v.currentTerm?.issuedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('EXPIRED once it has passed', () => {
    const v = deriveCompanyLicenseStanding(
      [
        {
          licenseNumber: 'IC-1',
          issuedAt: null,
          expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      now,
    );
    expect(v.standing).toBe('EXPIRED');
    // A null issue date does not make the term unusable — the expiry is the only date the
    // derivation needs, which is why `issuedAt` is nullable.
    expect(v.currentTerm?.issuedAt).toBeNull();
  });

  it('BOTH SIDES of the boundary, and ON it — a term expiring at this instant is still CURRENT', () => {
    const at = (iso: string) => [
      { licenseNumber: 'IC-1', issuedAt: null, expiresAt: new Date(iso) },
    ];
    // ON the instant. A `<` instead of `>=` would make a company expired on the last day of its own
    // licence, which is the same off-by-one direction `renewalFiledOnTime` had to get right.
    expect(
      deriveCompanyLicenseStanding(at(now.toISOString()), now).standing,
    ).toBe('CURRENT');
    expect(
      deriveCompanyLicenseStanding(at('2026-10-21T12:00:00.001Z'), now)
        .standing,
    ).toBe('CURRENT');
    expect(
      deriveCompanyLicenseStanding(at('2026-10-21T11:59:59.999Z'), now)
        .standing,
    ).toBe('EXPIRED');
  });

  it('A SERIES: the LATEST expiry decides, not the one covering today', () => {
    /*
     * The `pickCurrentTerm` reading, and for the same reason: between a renewal being recorded and
     * the old term running out a company holds TWO, and the newer one describes its standing.
     * Picking the covering term would report a renewed company as expiring.
     */
    const v = deriveCompanyLicenseStanding(
      [
        {
          licenseNumber: 'IC-OLD',
          issuedAt: null,
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
        },
        {
          licenseNumber: 'IC-NEW',
          issuedAt: null,
          expiresAt: new Date('2029-12-31T00:00:00.000Z'),
        },
      ],
      now,
    );
    expect(v.standing).toBe('CURRENT');
    expect(v.currentTerm?.licenseNumber).toBe('IC-NEW');
    expect(v.termCount).toBe(2);
  });

  it('and a RENEWED company whose old term has already lapsed still reads CURRENT', () => {
    // The case the covering-term reading gets wrong, which is why it is asserted on its own.
    const v = deriveCompanyLicenseStanding(
      [
        {
          licenseNumber: 'IC-OLD',
          issuedAt: null,
          expiresAt: new Date('2025-12-31T00:00:00.000Z'),
        },
        {
          licenseNumber: 'IC-NEW',
          issuedAt: null,
          expiresAt: new Date('2029-12-31T00:00:00.000Z'),
        },
      ],
      now,
    );
    expect(v.standing).toBe('CURRENT');
  });

  it('the tie-break is the LICENCE NUMBER, so the answer cannot depend on insertion order', () => {
    /*
     * A consumer taking `[0]` imposes an ordering requirement nothing type-checks — the
     * `findActiveUserIdsWithPermission` lesson, where which reviewer a subject got was decided by
     * the query plan on a segregation-of-duties control. Two terms sharing an expiry is admitted by
     * the unique (it keys on number AND expiry), so the order has to be total.
     */
    const a = {
      licenseNumber: 'IC-A',
      issuedAt: null,
      expiresAt: new Date('2029-12-31T00:00:00.000Z'),
    };
    const b = {
      licenseNumber: 'IC-B',
      issuedAt: null,
      expiresAt: new Date('2029-12-31T00:00:00.000Z'),
    };
    expect(pickCurrentCompanyTerm([a, b])?.licenseNumber).toBe('IC-A');
    expect(pickCurrentCompanyTerm([b, a])?.licenseNumber).toBe('IC-A');
  });

  it('and it does not mutate what it was given', () => {
    // `sort` is in-place, so the first version of a function like this reorders its caller's array.
    const terms = [
      {
        licenseNumber: 'IC-OLD',
        issuedAt: null,
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        licenseNumber: 'IC-NEW',
        issuedAt: null,
        expiresAt: new Date('2029-01-01T00:00:00.000Z'),
      },
    ];
    pickCurrentCompanyTerm(terms);
    expect(terms.map((t) => t.licenseNumber)).toEqual(['IC-OLD', 'IC-NEW']);
  });
});
