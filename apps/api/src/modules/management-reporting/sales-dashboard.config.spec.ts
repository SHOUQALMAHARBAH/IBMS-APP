import { describe, expect, it } from 'vitest';
import {
  buildSalesDashboardSummary,
  computeConversionRatePercent,
  deriveConversionMetric,
  deriveLeadsMetric,
  derivePremiumWrittenMetric,
} from './sales-dashboard.config';

describe('computeConversionRatePercent', () => {
  it('is 0, not NaN, for an empty cohort', () => {
    expect(computeConversionRatePercent(0, 0)).toBe(0);
  });

  it('rounds to 2dp', () => {
    expect(computeConversionRatePercent(1, 3)).toBe(33.33);
  });
});

describe('deriveLeadsMetric', () => {
  it('computes the conversion rate from newLeadsCount/convertedToProspectCount', () => {
    const m = deriveLeadsMetric(10, 4);
    expect(m).toEqual({
      newLeadsCount: 10,
      convertedToProspectCount: 4,
      conversionRatePercent: 40,
    });
  });
});

describe('deriveConversionMetric', () => {
  it('computes total/converted/rate for cross-sell or up-sell', () => {
    expect(deriveConversionMetric(5, 2)).toEqual({
      totalCount: 5,
      convertedCount: 2,
      conversionRatePercent: 40,
    });
  });
});

describe('derivePremiumWrittenMetric', () => {
  it('sums new + renewal as a real Decimal add, not floating-point string parsing', () => {
    const m = derivePremiumWrittenMetric('1000.100', '2000.200');
    expect(m).toEqual({
      newJod: '1000.100',
      renewalJod: '2000.200',
      totalJod: '3000.300',
    });
  });

  it('treats null sums as zero', () => {
    const m = derivePremiumWrittenMetric(null, null);
    expect(m).toEqual({
      newJod: '0.000',
      renewalJod: '0.000',
      totalJod: '0.000',
    });
  });
});

describe('buildSalesDashboardSummary', () => {
  it('composes every section from the raw inputs', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const period = {
      periodLabel: '2026-08',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    };
    const summary = buildSalesDashboardSummary({
      now,
      period,
      newLeadsCount: 20,
      convertedToProspectCount: 5,
      newPremiumSum: '5000.000',
      renewalPremiumSum: '3000.000',
      commissionSum: '800.000',
      crossSellTotal: 10,
      crossSellConverted: 3,
      upSellTotal: 4,
      upSellConverted: 1,
    });
    expect(summary.generatedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(summary.periodLabel).toBe('2026-08');
    expect(summary.leads.conversionRatePercent).toBe(25);
    expect(summary.premiumWritten.totalJod).toBe('8000.000');
    expect(summary.commissionIncomeJod).toBe('800.000');
    expect(summary.crossSell.conversionRatePercent).toBe(30);
    expect(summary.upSell.conversionRatePercent).toBe(25);
  });
});
