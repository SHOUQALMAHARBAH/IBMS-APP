import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  buildLossRatioBreakdown,
  computeLossRatio,
  lossRatioAuditSnapshot,
  type AnalyticsPolicyLike,
} from './loss-ratio.config';

const d = (s: string) => new Prisma.Decimal(s);

function pol(over: Partial<AnalyticsPolicyLike>): AnalyticsPolicyLike {
  return {
    id: 'pol-1',
    customerId: 'cus-1',
    customerLegalName: 'Acme Ltd',
    insuranceLine: 'Property All Risks',
    policyRef: 'POL-1',
    premium: d('10000.000'),
    claimNetSettlements: [],
    ...over,
  };
}

describe('computeLossRatio (Process 29)', () => {
  it('sums the net settlements and divides by the premium (worked example)', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('15000.000'), d('5000.000')],
      periodPremium: d('40000.000'),
    });
    expect(f.periodClaims.toFixed(3)).toBe('20000.000');
    expect(f.periodPremium.toFixed(3)).toBe('40000.000');
    expect(f.ratio.toFixed(4)).toBe('0.5000');
  });

  it('is zero claims / zero ratio when the policy has no settled claims', () => {
    const f = computeLossRatio({
      claimNetSettlements: [],
      periodPremium: d('10000.000'),
    });
    expect(f.periodClaims.toFixed(3)).toBe('0.000');
    expect(f.ratio.toFixed(4)).toBe('0.0000');
  });

  it('ignores null net settlements (an unsettled claim contributes nothing)', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('1200.000'), null, d('300.000')],
      periodPremium: d('3000.000'),
    });
    expect(f.periodClaims.toFixed(3)).toBe('1500.000');
    expect(f.ratio.toFixed(4)).toBe('0.5000');
  });

  it('quantizes the ratio to 4 dp with ROUND_HALF_UP', () => {
    // 1000 / 3000 = 0.33333... -> 0.3333
    const f = computeLossRatio({
      claimNetSettlements: [d('1000.000')],
      periodPremium: d('3000.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('0.3333');
  });

  it('yields a zero ratio (never a divide-by-zero) when the premium is zero', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('500.000')],
      periodPremium: d('0.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('0.0000');
    expect(f.ratioCapped).toBe(false);
  });

  it('caps the ratio at 999.9999 (the Decimal(7,4) column max) and flags it', () => {
    // 5,000,000 claims against a 1,000 premium -> 5000.0000, over the column max
    const f = computeLossRatio({
      claimNetSettlements: [d('5000000.000')],
      periodPremium: d('1000.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('999.9999');
    expect(f.ratioCapped).toBe(true);
  });

  it('does not flag a ratio that fits the column', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('12000.000')],
      periodPremium: d('10000.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('1.2000');
    expect(f.ratioCapped).toBe(false);
  });
});

describe('lossRatioAuditSnapshot', () => {
  it('carries ids + the three figures as fixed strings + the trigger, no narrative', () => {
    const snap = lossRatioAuditSnapshot({
      lossRatioId: 'lr-1',
      renewalCaseId: 'rc-1',
      policyId: 'pol-1',
      trigger: 'claim-closed',
      claimId: 'claim-1',
      figures: computeLossRatio({
        claimNetSettlements: [d('15000.000')],
        periodPremium: d('30000.000'),
      }),
    });
    expect(snap).toEqual({
      lossRatioId: 'lr-1',
      renewalCaseId: 'rc-1',
      policyId: 'pol-1',
      trigger: 'claim-closed',
      claimId: 'claim-1',
      periodClaims: '15000.000',
      periodPremium: '30000.000',
      ratio: '0.5000',
      ratioCapped: false,
    });
  });
});

describe('buildLossRatioBreakdown (Process 30)', () => {
  const policies: AnalyticsPolicyLike[] = [
    // Acme — 2 policies, different lines
    pol({
      id: 'p-a1',
      customerId: 'acme',
      customerLegalName: 'Acme Ltd',
      policyRef: 'POL-A1',
      insuranceLine: 'Property All Risks',
      premium: d('40000.000'),
      claimNetSettlements: [d('15000.000'), d('5000.000'), null], // 20000 paid
    }),
    pol({
      id: 'p-a2',
      customerId: 'acme',
      customerLegalName: 'Acme Ltd',
      policyRef: 'POL-A2',
      insuranceLine: 'Motor Fleet',
      premium: d('10000.000'),
      claimNetSettlements: [], // no settled claims
    }),
    // Beta — 1 property policy, a big loss
    pol({
      id: 'p-b1',
      customerId: 'beta',
      customerLegalName: 'Beta Co',
      policyRef: 'POL-B1',
      insuranceLine: 'Property All Risks',
      premium: d('20000.000'),
      claimNetSettlements: [d('30000.000')], // 30000 paid on 20000 premium -> 1.5
    }),
  ];

  it('groups by customer: one row per customer, pooled claims / premium, worst-first', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'customer', policies });
    expect(b.groupBy).toBe('customer');
    expect(b.rows.map((r) => r.key)).toEqual(['beta', 'acme']); // 1.5 before 0.4
    const acme = b.rows.find((r) => r.key === 'acme')!;
    expect(acme).toMatchObject({
      label: 'Acme Ltd',
      periodClaims: '20000.000',
      periodPremium: '50000.000', // 40000 + 10000
      ratio: '0.4000',
      claimCount: 2,
      policyCount: 2,
    });
    const beta = b.rows.find((r) => r.key === 'beta')!;
    expect(beta).toMatchObject({
      periodClaims: '30000.000',
      periodPremium: '20000.000',
      ratio: '1.5000',
      claimCount: 1,
      policyCount: 1,
    });
  });

  it('groups by line: pools across customers', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'line', policies });
    const property = b.rows.find((r) => r.key === 'Property All Risks')!;
    expect(property).toMatchObject({
      label: 'Property All Risks',
      periodClaims: '50000.000', // 20000 (Acme) + 30000 (Beta)
      periodPremium: '60000.000', // 40000 + 20000
      ratio: '0.8333', // 50000 / 60000
      claimCount: 3,
      policyCount: 2,
    });
    const motor = b.rows.find((r) => r.key === 'Motor Fleet')!;
    expect(motor).toMatchObject({
      ratio: '0.0000',
      claimCount: 0,
      policyCount: 1,
    });
  });

  it('groups by policy: one row per policy', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'policy', policies });
    expect(b.rows).toHaveLength(3);
    expect(b.rows.find((r) => r.key === 'p-a1')).toMatchObject({
      label: 'POL-A1',
      ratio: '0.5000', // 20000 / 40000
    });
  });

  it('totals pool every policy regardless of groupBy', () => {
    const byCustomer = buildLossRatioBreakdown({
      groupBy: 'customer',
      policies,
    });
    const byLine = buildLossRatioBreakdown({ groupBy: 'line', policies });
    // 50000 claims / 70000 premium -> 0.7143
    expect(byCustomer.totals).toMatchObject({
      periodClaims: '50000.000',
      periodPremium: '70000.000',
      ratio: '0.7143',
      claimCount: 3,
      policyCount: 3,
    });
    expect(byLine.totals).toEqual(byCustomer.totals);
  });

  it('is an empty breakdown (zero totals) when no policies match', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'customer', policies: [] });
    expect(b.rows).toEqual([]);
    expect(b.totals).toMatchObject({
      periodClaims: '0.000',
      periodPremium: '0.000',
      ratio: '0.0000',
      claimCount: 0,
      policyCount: 0,
    });
  });

  it('propagates the ratio cap into a group row', () => {
    const b = buildLossRatioBreakdown({
      groupBy: 'policy',
      policies: [
        pol({
          id: 'p-huge',
          premium: d('1000.000'),
          claimNetSettlements: [d('5000000.000')],
        }),
      ],
    });
    expect(b.rows[0]).toMatchObject({ ratio: '999.9999', ratioCapped: true });
    expect(b.totals.ratioCapped).toBe(true);
  });
});
