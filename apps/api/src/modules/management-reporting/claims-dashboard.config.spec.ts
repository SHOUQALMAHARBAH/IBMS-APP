import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  ageingBucketFor,
  buildClaimsDashboardSummary,
  buildOpenClaimsBreakdown,
  daysOpen,
  type OpenClaimRow,
} from './claims-dashboard.config';
import type { AnalyticsPolicyLike } from '../loss-ratio/loss-ratio.config';

const d = (s: string) => new Prisma.Decimal(s);

function claim(over: Partial<OpenClaimRow>): OpenClaimRow {
  return {
    id: 'claim-1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    estimatedLoss: d('1000.000'),
    netSettlement: null,
    ...over,
  };
}

describe('daysOpen', () => {
  it('counts whole UTC-midnight-to-midnight days', () => {
    expect(
      daysOpen(
        new Date('2026-08-01T23:00:00.000Z'),
        new Date('2026-08-11T01:00:00.000Z'),
      ),
    ).toBe(10);
  });

  it('never goes negative for a claim created after asOf', () => {
    expect(
      daysOpen(
        new Date('2026-08-10T00:00:00.000Z'),
        new Date('2026-08-01T00:00:00.000Z'),
      ),
    ).toBe(0);
  });
});

describe('ageingBucketFor', () => {
  it('has no "not yet due" bucket — day 0 is already d0_30', () => {
    expect(ageingBucketFor(0)).toBe('d0_30');
    expect(ageingBucketFor(30)).toBe('d0_30');
    expect(ageingBucketFor(31)).toBe('d31_60');
    expect(ageingBucketFor(60)).toBe('d31_60');
    expect(ageingBucketFor(61)).toBe('d61_90');
    expect(ageingBucketFor(90)).toBe('d61_90');
    expect(ageingBucketFor(91)).toBe('d90_plus');
  });
});

describe('buildOpenClaimsBreakdown', () => {
  const asOf = new Date('2026-09-01T00:00:00.000Z');

  it('uses netSettlement when a settlement already exists, else estimatedLoss', () => {
    const b = buildOpenClaimsBreakdown({
      asOf,
      openClaims: [
        claim({ id: 'c-1', estimatedLoss: d('1000.000'), netSettlement: null }),
        claim({
          id: 'c-2',
          estimatedLoss: d('5000.000'),
          netSettlement: d('4200.000'),
        }),
      ],
    });
    expect(b.openClaimsCount).toBe(2);
    expect(b.outstandingClaimsValueJod).toBe('5200.000'); // 1000 + 4200
  });

  it('buckets each claim by whole days open as of the reference date', () => {
    const b = buildOpenClaimsBreakdown({
      asOf,
      openClaims: [
        claim({
          id: 'c-fresh',
          createdAt: new Date('2026-08-25T00:00:00.000Z'),
          estimatedLoss: d('100.000'),
        }), // 7 days
        claim({
          id: 'c-mid',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          estimatedLoss: d('200.000'),
        }), // 62 days
        claim({
          id: 'c-old',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          estimatedLoss: d('300.000'),
        }), // way over 90
      ],
    });
    expect(b.ageing.d0_30).toEqual({ count: 1, valueJod: '100.000' });
    expect(b.ageing.d31_60.count).toBe(0);
    expect(b.ageing.d61_90).toEqual({ count: 1, valueJod: '200.000' });
    expect(b.ageing.d90_plus).toEqual({ count: 1, valueJod: '300.000' });
  });

  it('returns zeroed buckets and a zero total for no open claims', () => {
    const b = buildOpenClaimsBreakdown({ asOf, openClaims: [] });
    expect(b.openClaimsCount).toBe(0);
    expect(b.outstandingClaimsValueJod).toBe('0.000');
    expect(b.ageing.d0_30).toEqual({ count: 0, valueJod: '0.000' });
  });
});

describe('buildClaimsDashboardSummary', () => {
  it('composes open/closed counts, outstanding value, ageing, and all three loss-ratio breakdowns', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const asOf = new Date('2026-09-01T00:00:00.000Z');
    const openClaims: OpenClaimRow[] = [
      claim({
        id: 'c-1',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        estimatedLoss: d('1000.000'),
      }),
    ];
    const policies: AnalyticsPolicyLike[] = [
      {
        id: 'p-1',
        customerId: 'acme',
        customerLegalName: 'Acme Ltd',
        insuranceLine: 'Property All Risks',
        insurerId: 'ins-1',
        insurerName: 'National Insurance',
        policyRef: 'POL-1',
        premium: d('40000.000'),
        claimNetSettlements: [d('20000.000')],
      },
    ];

    const summary = buildClaimsDashboardSummary({
      now,
      asOf,
      closedClaimsCount: 3,
      openClaims,
      lossRatioPolicies: policies,
    });

    expect(summary.generatedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(summary.asOf).toBe('2026-09-01T00:00:00.000Z');
    expect(summary.openClaimsCount).toBe(1);
    expect(summary.closedClaimsCount).toBe(3);
    expect(summary.outstandingClaimsValueJod).toBe('1000.000');
    expect(summary.ageing.d0_30.count).toBe(1);
    expect(summary.lossRatioByClient).toHaveLength(1);
    expect(summary.lossRatioByClient[0]).toMatchObject({
      key: 'acme',
      ratio: '0.5000',
    });
    expect(summary.lossRatioByLine[0]).toMatchObject({
      key: 'Property All Risks',
    });
    expect(summary.lossRatioByInsurer[0]).toMatchObject({
      key: 'ins-1',
      label: 'National Insurance',
    });
  });
});
