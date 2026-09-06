import { describe, expect, it } from 'vitest';
import {
  computeDataShareReadiness,
  dpaRequiredForTier,
  dpoApprovalRequiredForTier,
} from './vendor.config';

describe('dpaRequiredForTier', () => {
  it('is false for low', () => expect(dpaRequiredForTier('low')).toBe(false));
  it('is true for medium', () =>
    expect(dpaRequiredForTier('medium')).toBe(true));
  it('is true for high', () => expect(dpaRequiredForTier('high')).toBe(true));
});

describe('dpoApprovalRequiredForTier', () => {
  it('is false for low', () =>
    expect(dpoApprovalRequiredForTier('low')).toBe(false));
  it('is false for medium', () =>
    expect(dpoApprovalRequiredForTier('medium')).toBe(false));
  it('is true for high', () =>
    expect(dpoApprovalRequiredForTier('high')).toBe(true));
});

describe('computeDataShareReadiness', () => {
  it('is not ready with no risk tier assigned', () => {
    const result = computeDataShareReadiness('v1', null, null);
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(['Risk tier has not been assigned yet.']);
  });

  it('is ready for Low tier regardless of DPA', () => {
    const result = computeDataShareReadiness('v1', 'low', null);
    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('is not ready for Medium tier with no DPA at all', () => {
    const result = computeDataShareReadiness('v1', 'medium', null);
    expect(result.ready).toBe(false);
  });

  it('is not ready for Medium tier with an unsigned DPA', () => {
    const result = computeDataShareReadiness('v1', 'medium', {
      id: 'dpa-1',
      signedAt: null,
      dpoApprovedByUserId: null,
    });
    expect(result.ready).toBe(false);
  });

  it('is ready for Medium tier once a DPA is signed (no DPO approval needed)', () => {
    const result = computeDataShareReadiness('v1', 'medium', {
      id: 'dpa-1',
      signedAt: new Date(),
      dpoApprovedByUserId: null,
    });
    expect(result.ready).toBe(true);
  });

  it('is not ready for High tier with a signed but unapproved DPA', () => {
    const result = computeDataShareReadiness('v1', 'high', {
      id: 'dpa-1',
      signedAt: new Date(),
      dpoApprovedByUserId: null,
    });
    expect(result.ready).toBe(false);
    expect(result.reasons[0]).toMatch(/DPO approval/);
  });

  it('is ready for High tier once DPO-approved', () => {
    const result = computeDataShareReadiness('v1', 'high', {
      id: 'dpa-1',
      signedAt: new Date(),
      dpoApprovedByUserId: 'dpo-1',
    });
    expect(result.ready).toBe(true);
  });
});
