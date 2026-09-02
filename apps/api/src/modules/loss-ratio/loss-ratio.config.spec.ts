import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import { computeLossRatio, lossRatioAuditSnapshot } from './loss-ratio.config';

const d = (s: string) => new Prisma.Decimal(s);

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
