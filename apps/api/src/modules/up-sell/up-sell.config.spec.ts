import { describe, expect, it } from 'vitest';
import {
  assessUnderinsurance,
  UNDERINSURANCE_THRESHOLD_PERCENT,
} from './up-sell.config';

describe('assessUnderinsurance', () => {
  it('flags when the asset value exceeds the Sum Insured by more than the threshold', () => {
    const v = assessUnderinsurance({
      currentSumInsured: '100000',
      currentAssetValue: '125000',
    });
    expect(v.isUnderinsured).toBe(true);
    expect(v.shortfall).toBe('25000.000');
    expect(v.thresholdAmount).toBe('10000.000'); // 10% of 100000
  });

  it('flags at exactly the threshold (>= , not >)', () => {
    const v = assessUnderinsurance({
      currentSumInsured: '100000',
      currentAssetValue: '110000',
    });
    expect(v.isUnderinsured).toBe(true);
    expect(v.shortfall).toBe('10000.000');
  });

  it('does not flag a shortfall just under the threshold', () => {
    const v = assessUnderinsurance({
      currentSumInsured: '100000',
      currentAssetValue: '109999.999',
    });
    expect(v.isUnderinsured).toBe(false);
  });

  it('does not flag when the customer is over-insured (asset value below Sum Insured)', () => {
    const v = assessUnderinsurance({
      currentSumInsured: '100000',
      currentAssetValue: '80000',
    });
    expect(v.isUnderinsured).toBe(false);
    expect(v.shortfall).toBe('-20000.000');
  });

  it('does not flag when the Sum Insured is zero (no honest percentage to measure)', () => {
    const v = assessUnderinsurance({
      currentSumInsured: '0',
      currentAssetValue: '500000',
    });
    expect(v.isUnderinsured).toBe(false);
    expect(v.thresholdAmount).toBe('0.000');
  });

  it('works at fils precision', () => {
    const v = assessUnderinsurance({
      currentSumInsured: '10.000',
      currentAssetValue: '11.001',
    });
    expect(v.shortfall).toBe('1.001');
    expect(v.thresholdAmount).toBe('1.000'); // 10% of 10
    expect(v.isUnderinsured).toBe(true);
  });

  it('exposes the threshold as a plain percentage string', () => {
    expect(UNDERINSURANCE_THRESHOLD_PERCENT).toBe('10');
  });
});
