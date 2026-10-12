import { describe, expect, it } from 'vitest';
import {
  brokerLicenseAuditSnapshot,
  deriveBrokerLicenseView,
  expectedExpiryForThreeYearTerm,
  expiryIsEndOfCalendarYear,
  isBrokerLicenseCurrentlyLapsed,
  isValidPendingRenewalDecision,
  pickCurrentTerm,
  renewalApplicationDueBy,
  renewalFiledOnTime,
  RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY,
  type BrokerLicenseRow,
} from './broker-license.config';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function row(overrides: Partial<BrokerLicenseRow> = {}): BrokerLicenseRow {
  return {
    // A uuid-shaped id, not `the-broker-license`: Module 0 item (c) retired that constant, which
    // had been the table's PRIMARY KEY and therefore allowed one licence row per PLATFORM.
    id: 'b1f0c0de-0000-4000-8000-000000000001',
    licenseNumber: 'CBJ-2026-001',
    scopeOfAuthorization: 'General insurance brokerage',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    status: 'active',
    certificateDocumentId: 'doc-certificate-1',
    renewalRequestedAt: null,
    ...overrides,
  };
}

describe('isBrokerLicenseCurrentlyLapsed (Process 51)', () => {
  it('is not lapsed while active and before expiry', () => {
    expect(isBrokerLicenseCurrentlyLapsed(row(), NOW)).toBe(false);
  });

  it('is lapsed once expiresAt has passed, even if status still reads active', () => {
    expect(
      isBrokerLicenseCurrentlyLapsed(
        row({ expiresAt: new Date('2026-01-01T00:00:00.000Z') }),
        NOW,
      ),
    ).toBe(true);
  });

  it('is lapsed exactly at the expiry instant (inclusive boundary)', () => {
    expect(isBrokerLicenseCurrentlyLapsed(row({ expiresAt: NOW }), NOW)).toBe(
      true,
    );
  });

  it('is lapsed when manually marked lapsed, even with a future expiry', () => {
    expect(isBrokerLicenseCurrentlyLapsed(row({ status: 'lapsed' }), NOW)).toBe(
      true,
    );
  });
});

describe('deriveBrokerLicenseView (Process 51)', () => {
  it('carries the live-derived isCurrentlyLapsed alongside the raw stored status', () => {
    const view = deriveBrokerLicenseView(
      row({
        status: 'active',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      NOW,
    );
    expect(view.status).toBe('active');
    expect(view.isCurrentlyLapsed).toBe(true);
  });

  it('serializes null issuedAt/scopeOfAuthorization as null, not undefined', () => {
    const view = deriveBrokerLicenseView(
      row({ issuedAt: null, scopeOfAuthorization: null }),
      NOW,
    );
    expect(view.issuedAt).toBeNull();
    expect(view.scopeOfAuthorization).toBeNull();
  });
});

describe('brokerLicenseAuditSnapshot (Process 51)', () => {
  it('includes scopeOfAuthorization verbatim (not customer data, no guard needed)', () => {
    const snapshot = brokerLicenseAuditSnapshot(row());
    expect(snapshot.scopeOfAuthorization).toBe('General insurance brokerage');
    expect(snapshot.licenseNumber).toBe('CBJ-2026-001');
    expect(snapshot.status).toBe('active');
  });
});

describe('pickCurrentTerm (Module 0 item c)', () => {
  it('is null for an office with no terms', () => {
    // NOT the same as "not blocked" — `PolicyService.assertLicenseNotLapsed` refuses on this.
    expect(pickCurrentTerm([])).toBeNull();
  });

  it('picks the term with the LATEST expiry, whatever order they arrive in', () => {
    const older = row({ id: 'older', expiresAt: new Date('2025-12-31') });
    const newer = row({ id: 'newer', expiresAt: new Date('2028-12-31') });
    expect(pickCurrentTerm([older, newer])?.id).toBe('newer');
    expect(pickCurrentTerm([newer, older])?.id).toBe('newer');
  });

  it('prefers the newer term even while the older one still covers today', () => {
    // The case the choice exists for. A renewal is filed 45 days before expiry (art. 11), so an
    // office legitimately holds two terms at once; "the term covering today" would answer with the
    // outgoing one and report an office as lapsing when it has already been renewed.
    const outgoing = row({ id: 'outgoing', expiresAt: new Date('2026-12-31') });
    const incoming = row({
      id: 'incoming',
      issuedAt: new Date('2026-11-15'),
      expiresAt: new Date('2029-12-31'),
    });
    const duringTheOverlap = new Date('2026-12-01T00:00:00.000Z');
    const current = pickCurrentTerm([outgoing, incoming]);
    expect(current?.id).toBe('incoming');
    expect(isBrokerLicenseCurrentlyLapsed(current!, duringTheOverlap)).toBe(
      false,
    );
  });
});

describe('the term and renewal rules — Module 0 item (d)', () => {
  /*
   * CBJ Instructions No. 9 of 2026: art. 10/b (a term is three calendar years ending 31 December),
   * art. 11 (the renewal application is due 45 days before expiry).
   */
  const EXPIRES = new Date('2028-12-31T00:00:00.000Z');
  // 45 calendar days before 31 Dec 2028 = 16 Nov 2028.
  const DEADLINE = new Date('2028-11-16T00:00:00.000Z');

  describe('renewalApplicationDueBy (art. 11)', () => {
    it('is 45 CALENDAR days before expiry', () => {
      expect(RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY).toBe(45);
      expect(renewalApplicationDueBy(EXPIRES).toISOString()).toBe(
        DEADLINE.toISOString(),
      );
    });

    it('crosses a month and a leap-year February without drifting', () => {
      // 45 days before 2028-03-15, in a leap year (2028), is 2028-01-30. Asserted because a
      // month-arithmetic implementation would land on 2028-01-31 and be wrong by a day in exactly
      // the direction that reports an on-time filing as late.
      expect(
        renewalApplicationDueBy(new Date('2028-03-15T00:00:00.000Z'))
          .toISOString()
          .slice(0, 10),
      ).toBe('2028-01-30');
    });
  });

  describe('renewalFiledOnTime (art. 11)', () => {
    it('is false when nothing was filed — the case that decides whether an office expires', () => {
      expect(
        renewalFiledOnTime({ expiresAt: EXPIRES, renewalRequestedAt: null }),
      ).toBe(false);
    });

    it('is true ON the deadline, not just before it', () => {
      // A boundary that matters: "due 45 days before" includes the 45th day, and an
      // implementation using `<` would make an office filing exactly on time late.
      expect(
        renewalFiledOnTime({
          expiresAt: EXPIRES,
          renewalRequestedAt: DEADLINE,
        }),
      ).toBe(true);
    });

    it('is false one day after the deadline', () => {
      expect(
        renewalFiledOnTime({
          expiresAt: EXPIRES,
          renewalRequestedAt: new Date('2028-11-17T00:00:00.000Z'),
        }),
      ).toBe(false);
    });
  });

  describe('expiryIsEndOfCalendarYear (art. 10/b) — a WARNING, never a block', () => {
    it('accepts 31 December', () => {
      expect(expiryIsEndOfCalendarYear(EXPIRES)).toBe(true);
    });

    it('rejects any other date, including 30 December and 1 January', () => {
      expect(
        expiryIsEndOfCalendarYear(new Date('2028-12-30T00:00:00.000Z')),
      ).toBe(false);
      expect(
        expiryIsEndOfCalendarYear(new Date('2029-01-01T00:00:00.000Z')),
      ).toBe(false);
    });

    it('reads the UTC date, so the answer does not depend on the server timezone', () => {
      // A date printed on a certificate cannot mean different things on different machines. Local
      // getters would flip this one for any host west of UTC.
      expect(
        expiryIsEndOfCalendarYear(new Date('2028-12-31T00:00:00.000Z')),
      ).toBe(true);
    });
  });

  describe('expectedExpiryForThreeYearTerm — informational, nothing refuses on it', () => {
    it('is 31 December of the issue year + 2, counting the year of issue', () => {
      expect(
        expectedExpiryForThreeYearTerm(new Date('2026-01-01T00:00:00.000Z'))
          ?.toISOString()
          .slice(0, 10),
      ).toBe('2028-12-31');
    });

    it('is null when no issue date was recorded', () => {
      expect(expectedExpiryForThreeYearTerm(null)).toBeNull();
    });
  });

  describe("isBrokerLicenseCurrentlyLapsed — the renewal-pending rule (owner's decision, not art. 11)", () => {
    const past = new Date('2029-02-01T00:00:00.000Z');

    it('lapses after expiry when NOTHING was filed', () => {
      expect(
        isBrokerLicenseCurrentlyLapsed(
          { status: 'active', expiresAt: EXPIRES, renewalRequestedAt: null },
          past,
        ),
      ).toBe(true);
    });

    it('lapses after expiry when the application was filed LATE', () => {
      expect(
        isBrokerLicenseCurrentlyLapsed(
          {
            status: 'active',
            expiresAt: EXPIRES,
            renewalRequestedAt: new Date('2028-12-20T00:00:00.000Z'),
          },
          past,
        ),
      ).toBe(true);
    });

    it('does NOT lapse after expiry when the application was filed on time', () => {
      // The whole point of item (d): after 31 December an office that applied on time stays valid
      // until the decision issues. Treating it as lapsed would block new business the regulation
      // permits — an error running against the brokerage.
      expect(
        isBrokerLicenseCurrentlyLapsed(
          {
            status: 'active',
            expiresAt: EXPIRES,
            renewalRequestedAt: DEADLINE,
          },
          past,
        ),
      ).toBe(false);
    });

    it('a MANUAL lapse outranks a timely filing — a suspension is not cured by applying', () => {
      // Ordering, asserted rather than assumed: checking the extension first would let a filed
      // application paper over a CBJ intervention.
      expect(
        isBrokerLicenseCurrentlyLapsed(
          {
            status: 'lapsed',
            expiresAt: EXPIRES,
            renewalRequestedAt: DEADLINE,
          },
          past,
        ),
      ).toBe(true);
    });
  });

  describe('isValidPendingRenewalDecision — its own flag, not folded into isCurrentlyLapsed', () => {
    const past = new Date('2029-02-01T00:00:00.000Z');
    const inside = new Date('2028-06-01T00:00:00.000Z');

    it('is true only once past expiry with a timely application pending', () => {
      expect(
        isValidPendingRenewalDecision(
          {
            status: 'active',
            expiresAt: EXPIRES,
            renewalRequestedAt: DEADLINE,
          },
          past,
        ),
      ).toBe(true);
    });

    it('is false INSIDE the term even with a timely application — nothing is being extended yet', () => {
      expect(
        isValidPendingRenewalDecision(
          {
            status: 'active',
            expiresAt: EXPIRES,
            renewalRequestedAt: DEADLINE,
          },
          inside,
        ),
      ).toBe(false);
    });

    it('is false when the term was manually lapsed', () => {
      expect(
        isValidPendingRenewalDecision(
          {
            status: 'lapsed',
            expiresAt: EXPIRES,
            renewalRequestedAt: DEADLINE,
          },
          past,
        ),
      ).toBe(false);
    });

    it('is false when nothing was filed', () => {
      expect(
        isValidPendingRenewalDecision(
          { status: 'active', expiresAt: EXPIRES, renewalRequestedAt: null },
          past,
        ),
      ).toBe(false);
    });
  });

  describe('the view carries all of it', () => {
    it('reports the deadline, the on-time answer and both warnings', () => {
      const view = deriveBrokerLicenseView(
        row({
          issuedAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: EXPIRES,
          renewalRequestedAt: DEADLINE,
        }),
        new Date('2029-02-01T00:00:00.000Z'),
      );
      expect(view.renewalDueBy).toBe(DEADLINE.toISOString());
      expect(view.renewalFiledOnTime).toBe(true);
      expect(view.validPendingRenewalDecision).toBe(true);
      // Expired on the calendar AND not lapsed — the pair a screen needs to explain itself.
      expect(view.isCurrentlyLapsed).toBe(false);
      expect(view.expiryIsEndOfCalendarYear).toBe(true);
      expect(view.expectedExpiryForThreeYearTerm).toBe(EXPIRES.toISOString());
    });

    it('flags an expiry that is not a 31 December without refusing it', () => {
      const view = deriveBrokerLicenseView(
        row({ expiresAt: new Date('2028-06-30T00:00:00.000Z') }),
        new Date('2027-01-01T00:00:00.000Z'),
      );
      expect(view.expiryIsEndOfCalendarYear).toBe(false);
      // Not blocked, not lapsed: the certificate is the authority and the date is entered as
      // printed. The warning is for a human to verify, which is the whole of the requirement.
      expect(view.isCurrentlyLapsed).toBe(false);
    });
  });
});
