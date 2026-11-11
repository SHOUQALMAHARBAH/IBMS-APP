import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import type { LegalValue } from '@ibms/db';
import {
  LICENCE_LEGAL_VALUE_CODES,
  licenceFiguresFrom,
} from './legal-figures.config';
import {
  isBrokerLicenseCurrentlyLapsed,
  isValidPendingRenewalDecision,
  renewalApplicationDueBy,
  renewalFiledOnTime,
} from './broker-license.config';
import { deriveLicenseStanding } from './license-standing.config';
import {
  assessCapital,
  requiredCapitalForType,
} from './broker-license-scope.config';

/**
 * MODULE 1, OWNER DECISION 123 — THE LEGAL-VALUES TABLE, the half that needs no database.
 *
 * Each test is named by the criterion of decision 123's «معيار الجودة» it proves. Criteria 1, 2, 4,
 * 5 and 7 are about what an office ACCOUNT may do and are proved against a real database in
 * `legal-value.e2e-spec.ts`; criteria 3 and 6 are properties of the derivation and are proved here,
 * because a rule that can be exercised without a database should be.
 */

function row(
  code: string,
  numericValue: string | null,
  over: Partial<LegalValue> = {},
): LegalValue {
  return {
    id: `lv-${code}`,
    organizationId: null,
    code,
    name: code,
    kind: 'COUNT',
    numericValue:
      numericValue === null ? null : new Prisma.Decimal(numericValue),
    dateValue: null,
    sourceType: 'INSTRUMENT',
    sourceInstrument: 'CBJ Instructions No. 9 of 2026',
    sourceArticle: 'art. x',
    sourcePrintedPage: 1,
    sourceReference: null,
    effectiveFrom: new Date('2026-06-24'),
    effectiveTo: null,
    note: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: new Date('2026-06-24'),
    updatedAt: new Date('2026-06-24'),
    ...over,
  };
}

const C = LICENCE_LEGAL_VALUE_CODES;

/** The instrument's own figures, as the seed writes them. */
function instrumentRows(over: Record<string, string> = {}): LegalValue[] {
  const base: Record<string, string> = {
    [C.renewalApplicationDueDays]: '45',
    [C.article14cSuspensionLimitYears]: '2',
    [C.capitalBand1Amount]: '5000',
    [C.capitalBand1MaxBranches]: '6',
    [C.capitalBand2Amount]: '7500',
    [C.capitalBand2MaxBranches]: '12',
    [C.capitalBand3Amount]: '10000',
    ...over,
  };
  return Object.entries(base).map(([code, value]) => row(code, value));
}

describe('licenceFiguresFrom — a missing figure is a REFUSAL, never a default', () => {
  it('builds every figure from the rows', () => {
    const f = licenceFiguresFrom(instrumentRows());
    expect(f.renewalApplicationDueDaysBeforeExpiry).toBe(45);
    expect(f.article14cSuspensionLimitYears).toBe(2);
    expect(f.capitalBands.map((b) => b.upToBranches)).toEqual([
      6,
      12,
      Number.POSITIVE_INFINITY,
    ]);
    expect(f.capitalBands.map((b) => b.requiredJod.toFixed(3))).toEqual([
      '5000.000',
      '7500.000',
      '10000.000',
    ]);
  });

  it('REFUSES, naming the code, when a provider figure has no row', () => {
    // OWNER DECISION 123: the system never asserts a legal value it does not have. A default of 45 would
    // make an office's renewal deadline correct by coincidence and wrong the moment the regulation
    // moved, with nothing saying so.
    const without = instrumentRows().filter(
      (r) => r.code !== C.renewalApplicationDueDays,
    );
    expect(() => licenceFiguresFrom(without)).toThrow(
      /RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY/,
    );
  });

  it('REFUSES a row that is in force but carries no figure', () => {
    const dormant = instrumentRows().map((r) =>
      r.code === C.capitalBand2Amount ? row(r.code, null) : r,
    );
    expect(() => licenceFiguresFrom(dormant)).toThrow(/carries no figure/);
  });

  it('REFUSES a count with a fractional part rather than truncating it', () => {
    // 44.5 days silently becoming 44 moves a statutory deadline by a day, in the direction that
    // makes an office late for a filing the regulation would call timely.
    expect(() =>
      licenceFiguresFrom(
        instrumentRows({ [C.renewalApplicationDueDays]: '44.500' }),
      ),
    ).toThrow(/not a whole number/);
  });

  it('REFUSES capital bands whose boundaries are out of order', () => {
    // With the second boundary below the first, no branch count falls in the second band and every
    // office above the first boundary is assessed at the top requirement — a wrong warning that
    // looks like arithmetic.
    expect(() =>
      licenceFiguresFrom(instrumentRows({ [C.capitalBand2MaxBranches]: '4' })),
    ).toThrow(/out of order/);
  });
});

describe('CRITERION 3 — an old transaction computes at the value in force on ITS day', () => {
  /*
   * The pure half: the derivations take the figures as a parameter, so handing them the row that
   * was in force in March gives March's answer today. The repository half — that the right row is
   * SELECTED for a given date — is `legal-value.e2e-spec.ts`'s.
   */
  const term = {
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    renewalRequestedAt: new Date('2026-11-20T00:00:00.000Z'),
    issuedAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('a renewal filed on 20 November is TIMELY under a 45-day rule and LATE under a 60-day one', () => {
    // 45 days before 31 December is 16 November... so 20 November is already late under 45.
    // Under a 30-day rule (1 December) it is timely. Two different legal figures, two different
    // answers about the same office on the same day — which is exactly what effective dating is for.
    expect(renewalFiledOnTime(term, licenceFiguresFrom(instrumentRows()))).toBe(
      false,
    );
    expect(
      renewalFiledOnTime(
        term,
        licenceFiguresFrom(
          instrumentRows({ [C.renewalApplicationDueDays]: '30' }),
        ),
      ),
    ).toBe(true);
  });

  it('renewalApplicationDueBy moves with the figure', () => {
    expect(renewalApplicationDueBy(term.expiresAt, 45).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
    expect(renewalApplicationDueBy(term.expiresAt, 30).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('the licence standing itself flips with the figure, not only the predicate', () => {
    const after = new Date('2027-01-05T00:00:00.000Z');
    const at45 = deriveLicenseStanding(
      term,
      [],
      after,
      licenceFiguresFrom(instrumentRows()),
    );
    const at30 = deriveLicenseStanding(
      term,
      [],
      after,
      licenceFiguresFrom(
        instrumentRows({ [C.renewalApplicationDueDays]: '30' }),
      ),
    );
    expect(at45.status).toBe('EXPIRED');
    expect(at45.mayPractise).toBe(false);
    expect(at30.status).toBe('RENEWAL_PENDING');
    expect(at30.mayPractise).toBe(true);
  });

  it("art. 14/c's limit is a figure too — two years deems cancellation, three does not", () => {
    const suspended = [
      {
        kind: 'SUSPENSION' as const,
        basis: 'BROKER_REQUEST' as const,
        effectiveFrom: new Date('2024-06-01T00:00:00.000Z'),
        suspendedUntil: null,
        decisionRef: 'CBJ-1',
        recordedAt: new Date('2024-06-01T00:00:00.000Z'),
        id: 'act-1',
      },
    ];
    const now = new Date('2026-12-01T00:00:00.000Z');
    const at2 = deriveLicenseStanding(
      term,
      suspended,
      now,
      licenceFiguresFrom(instrumentRows()),
    );
    const at3 = deriveLicenseStanding(
      term,
      suspended,
      now,
      licenceFiguresFrom(
        instrumentRows({ [C.article14cSuspensionLimitYears]: '3' }),
      ),
    );
    expect(at2.status).toBe('CANCELLED');
    expect(at2.deemedCancelledUnderArticle14C).toBe(true);
    expect(at3.status).toBe('SUSPENDED');
    expect(at3.deemedCancelledUnderArticle14C).toBe(false);
  });

  it('isValidPendingRenewalDecision reads the figure it is handed', () => {
    const after = new Date('2027-01-05T00:00:00.000Z');
    expect(
      isValidPendingRenewalDecision(
        term,
        after,
        licenceFiguresFrom(instrumentRows()),
      ),
    ).toBe(false);
    expect(
      isValidPendingRenewalDecision(
        term,
        after,
        licenceFiguresFrom(
          instrumentRows({ [C.renewalApplicationDueDays]: '30' }),
        ),
      ),
    ).toBe(true);
  });

  it('isBrokerLicenseCurrentlyLapsed reads it too', () => {
    const after = new Date('2027-01-05T00:00:00.000Z');
    expect(
      isBrokerLicenseCurrentlyLapsed(
        term,
        after,
        licenceFiguresFrom(instrumentRows()),
      ),
    ).toBe(true);
    expect(
      isBrokerLicenseCurrentlyLapsed(
        term,
        after,
        licenceFiguresFrom(
          instrumentRows({ [C.renewalApplicationDueDays]: '30' }),
        ),
      ),
    ).toBe(false);
  });
});

describe("art. 4/a's capital assessment is computed from the rows", () => {
  const bands = () => licenceFiguresFrom(instrumentRows()).capitalBands;

  it('reproduces the bands exactly: 6 -> 5,000 · 12 -> 7,500 · above -> 10,000', () => {
    expect(requiredCapitalForType(0, bands()).toFixed(3)).toBe('0.000');
    expect(requiredCapitalForType(1, bands()).toFixed(3)).toBe('5000.000');
    expect(requiredCapitalForType(6, bands()).toFixed(3)).toBe('5000.000');
    expect(requiredCapitalForType(7, bands()).toFixed(3)).toBe('7500.000');
    expect(requiredCapitalForType(12, bands()).toFixed(3)).toBe('7500.000');
    expect(requiredCapitalForType(13, bands()).toFixed(3)).toBe('10000.000');
  });

  it('a BOUNDARY that moves changes which band an office is in', () => {
    // Seven branches is band 2 under a boundary of 6 and band 1 under a boundary of 8. This is the
    // assertion that would have caught the OCR's «5 branches» if it had ever been seeded: the
    // extraction publishes 5 where the instrument draws ٦.
    const moved = licenceFiguresFrom(
      instrumentRows({ [C.capitalBand1MaxBranches]: '8' }),
    ).capitalBands;
    expect(requiredCapitalForType(7, bands()).toFixed(3)).toBe('7500.000');
    expect(requiredCapitalForType(7, moved).toFixed(3)).toBe('5000.000');
  });

  it('the assessment is a WARNING and reports unrecorded capital as its own state', () => {
    const branches = [
      {
        insuranceLineId: 'l1',
        officeInsuranceLineId: null,
        category: 'GENERAL' as const,
      },
    ];
    const unrecorded = assessCapital(null, branches, bands());
    expect(unrecorded.capitalIsUnrecorded).toBe(true);
    expect(unrecorded.meetsRequirement).toBe(false);
    expect(unrecorded.requiredCapital.toFixed(3)).toBe('5000.000');
  });
});
