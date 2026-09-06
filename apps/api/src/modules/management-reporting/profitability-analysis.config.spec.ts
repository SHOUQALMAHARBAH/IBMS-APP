import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import { buildProfitabilityAnalysis } from './profitability-analysis.config';
import type { ProfitabilityPolicyRow } from '../../repositories/profitability-policy.repository';

const d = (v: string) => new Prisma.Decimal(v);

function policy(
  over: Partial<ProfitabilityPolicyRow> = {},
): ProfitabilityPolicyRow {
  return {
    policyId: 'pol-1',
    insuranceLine: 'Motor',
    customerType: 'CORPORATE',
    premium: d('10000.000'),
    claimNetSettlements: [],
    commissionAmount: d('1000.000'),
    commissionReversedAmount: null,
    ...over,
  };
}

describe('buildProfitabilityAnalysis', () => {
  it('computes commission income, cost-to-serve, and net profitability per line', () => {
    const result = buildProfitabilityAnalysis([
      policy({
        policyId: 'p1',
        insuranceLine: 'Motor',
        commissionAmount: d('1000.000'),
        claimNetSettlements: [d('400.000')],
      }),
      policy({
        policyId: 'p2',
        insuranceLine: 'Motor',
        commissionAmount: d('500.000'),
        claimNetSettlements: [],
      }),
    ]);

    expect(result.byLine).toEqual([
      {
        key: 'Motor',
        commissionIncomeJod: '1500.000',
        costToServeJod: '400.000',
        netProfitabilityJod: '1100.000',
        policyCount: 2,
        claimCount: 1,
      },
    ]);
  });

  it('nets commissionReversedAmount out of commission income (not gross, unlike #58/#61)', () => {
    const result = buildProfitabilityAnalysis([
      policy({
        commissionAmount: d('1000.000'),
        commissionReversedAmount: d('300.000'),
      }),
    ]);
    expect(result.totals.commissionIncomeJod).toBe('700.000');
  });

  it('treats a null commissionAmount as zero income, not a crash', () => {
    const result = buildProfitabilityAnalysis([
      policy({ commissionAmount: null, commissionReversedAmount: null }),
    ]);
    expect(result.totals.commissionIncomeJod).toBe('0.000');
  });

  it('sums only non-null claim net settlements as cost-to-serve', () => {
    const result = buildProfitabilityAnalysis([
      policy({
        claimNetSettlements: [d('100.000'), null, d('50.000')],
      }),
    ]);
    expect(result.totals.costToServeJod).toBe('150.000');
    expect(result.totals.claimCount).toBe(2);
  });

  it('can produce a negative netProfitabilityJod when cost-to-serve exceeds commission income', () => {
    const result = buildProfitabilityAnalysis([
      policy({
        commissionAmount: d('200.000'),
        claimNetSettlements: [d('5000.000')],
      }),
    ]);
    expect(result.totals.netProfitabilityJod).toBe('-4800.000');
  });

  it('groups by customerType for the bySegment breakdown', () => {
    const result = buildProfitabilityAnalysis([
      policy({ customerType: 'CORPORATE', commissionAmount: d('1000.000') }),
      policy({ customerType: 'INDIVIDUAL', commissionAmount: d('200.000') }),
    ]);
    const corporate = result.bySegment.find((r) => r.key === 'CORPORATE');
    const individual = result.bySegment.find((r) => r.key === 'INDIVIDUAL');
    expect(corporate?.commissionIncomeJod).toBe('1000.000');
    expect(individual?.commissionIncomeJod).toBe('200.000');
  });

  it('sorts worst-first by netProfitabilityJod, the #40 groupProfitability convention', () => {
    const result = buildProfitabilityAnalysis([
      policy({
        insuranceLine: 'Property',
        commissionAmount: d('5000.000'),
        claimNetSettlements: [],
      }),
      policy({
        insuranceLine: 'Motor',
        commissionAmount: d('100.000'),
        claimNetSettlements: [d('9000.000')],
      }),
    ]);
    expect(result.byLine.map((r) => r.key)).toEqual(['Motor', 'Property']);
  });

  it('returns empty breakdowns and zeroed totals for an empty book', () => {
    const result = buildProfitabilityAnalysis([]);
    expect(result.byLine).toEqual([]);
    expect(result.bySegment).toEqual([]);
    expect(result.totals).toEqual({
      commissionIncomeJod: '0.000',
      costToServeJod: '0.000',
      netProfitabilityJod: '0.000',
      policyCount: 0,
      claimCount: 0,
    });
  });
});
