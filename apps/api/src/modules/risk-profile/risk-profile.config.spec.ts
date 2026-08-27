import { describe, expect, it } from 'vitest';
import {
  consolidateSites,
  deriveSumInsured,
  type SiteSurvey,
  type SurveyableAsset,
} from './risk-profile.config';

function asset(overrides: Partial<SurveyableAsset>): SurveyableAsset {
  return {
    assetType: 'building',
    declaredValue: null,
    annualGrossProfit: null,
    indemnityPeriodMonths: null,
    fleetVehicleCount: null,
    ...overrides,
  };
}

describe('deriveSumInsured', () => {
  it('is all-zero for an empty survey', () => {
    expect(deriveSumInsured([])).toEqual({
      propertySumInsured: '0.000',
      businessInterruptionSumInsured: '0.000',
      totalSumInsured: '0.000',
      indemnityPeriodMonths: null,
      fleetVehicleCount: 0,
      assetCount: 0,
    });
  });

  it('rolls building/equipment/stock/other declared values into the property Sum Insured', () => {
    const summary = deriveSumInsured([
      asset({ assetType: 'building', declaredValue: '500000' }),
      asset({ assetType: 'equipment', declaredValue: '120000.500' }),
      asset({ assetType: 'stock', declaredValue: '80000' }),
      asset({ assetType: 'other', declaredValue: '10000.250' }),
    ]);
    expect(summary.propertySumInsured).toBe('710000.750');
    expect(summary.totalSumInsured).toBe('710000.750');
    expect(summary.assetCount).toBe(4);
  });

  it('excludes a vehicle asset from the property Sum Insured and counts its fleet', () => {
    const summary = deriveSumInsured([
      asset({ assetType: 'building', declaredValue: '500000' }),
      asset({
        assetType: 'vehicle',
        declaredValue: null,
        fleetVehicleCount: 12,
      }),
      asset({
        assetType: 'vehicle',
        declaredValue: null,
        fleetVehicleCount: 3,
      }),
    ]);
    expect(summary.propertySumInsured).toBe('500000.000');
    expect(summary.fleetVehicleCount).toBe(15);
  });

  it('sums annual gross profit into the BI Sum Insured and takes the longest indemnity period', () => {
    const summary = deriveSumInsured([
      asset({
        assetType: 'building',
        annualGrossProfit: '480000',
        indemnityPeriodMonths: 12,
      }),
      asset({
        assetType: 'stock',
        annualGrossProfit: '120000',
        indemnityPeriodMonths: 24,
      }),
    ]);
    expect(summary.businessInterruptionSumInsured).toBe('600000.000');
    expect(summary.indemnityPeriodMonths).toBe(24);
    expect(summary.totalSumInsured).toBe('600000.000');
  });

  it('adds property and BI Sum Insured for the total, at fils precision', () => {
    const summary = deriveSumInsured([
      asset({ assetType: 'building', declaredValue: '100.005' }),
      asset({ assetType: 'building', annualGrossProfit: '0.001' }),
    ]);
    expect(summary.propertySumInsured).toBe('100.005');
    expect(summary.businessInterruptionSumInsured).toBe('0.001');
    expect(summary.totalSumInsured).toBe('100.006');
  });

  it('leaves the indemnity period null when an asset declares a period but no BI basis', () => {
    const summary = deriveSumInsured([
      asset({ assetType: 'building', declaredValue: '100000' }),
    ]);
    expect(summary.indemnityPeriodMonths).toBeNull();
  });
});

describe('consolidateSites', () => {
  function site(label: string, assets: SurveyableAsset[]): SiteSurvey {
    return {
      riskProfileId: `rp-${label}`,
      siteLabel: label,
      summary: deriveSumInsured(assets),
    };
  }

  it('rolls every site into one consolidated Sum Insured', () => {
    const consolidated = consolidateSites('cust-1', [
      site('HQ', [
        asset({ assetType: 'building', declaredValue: '500000' }),
        asset({
          assetType: 'building',
          annualGrossProfit: '200000',
          indemnityPeriodMonths: 12,
        }),
      ]),
      site('Aqaba', [
        asset({ assetType: 'stock', declaredValue: '150000' }),
        asset({
          assetType: 'vehicle',
          declaredValue: null,
          fleetVehicleCount: 8,
        }),
        asset({
          assetType: 'stock',
          annualGrossProfit: '90000',
          indemnityPeriodMonths: 18,
        }),
      ]),
    ]);

    expect(consolidated.customerId).toBe('cust-1');
    expect(consolidated.consolidated).toEqual({
      propertySumInsured: '650000.000',
      businessInterruptionSumInsured: '290000.000',
      totalSumInsured: '940000.000',
      indemnityPeriodMonths: 18,
      fleetVehicleCount: 8,
      siteCount: 2,
    });
  });

  it('is all-zero when the customer has no sites', () => {
    const consolidated = consolidateSites('cust-1', []);
    expect(consolidated.sites).toEqual([]);
    expect(consolidated.consolidated).toEqual({
      propertySumInsured: '0.000',
      businessInterruptionSumInsured: '0.000',
      totalSumInsured: '0.000',
      indemnityPeriodMonths: null,
      fleetVehicleCount: 0,
      siteCount: 0,
    });
  });
});
