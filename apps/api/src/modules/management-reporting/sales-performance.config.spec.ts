import { describe, expect, it } from 'vitest';
import type { SalesTarget } from '@ibms/db';
import {
  computeAchievementPercent,
  deriveSalesTargetView,
  isExactlyOneScope,
  salesTargetAuditSnapshot,
} from './sales-performance.config';

const ROW: SalesTarget = {
  id: 'target-1',
  ownerUserId: 'user-1',
  branchId: null,
  periodLabel: '2026-Q4',
  periodStart: new Date('2026-10-01T00:00:00.000Z'),
  periodEnd: new Date('2027-01-01T00:00:00.000Z'),
  targetNewProspects: 20,
  createdByUserId: 'manager-1',
  createdAt: new Date('2026-09-10T09:00:00.000Z'),
  updatedAt: new Date('2026-09-10T09:00:00.000Z'),
};

describe('isExactlyOneScope', () => {
  it('is true when only ownerUserId is set', () => {
    expect(isExactlyOneScope('user-1', undefined)).toBe(true);
  });

  it('is true when only branchId is set', () => {
    expect(isExactlyOneScope(undefined, 'branch-1')).toBe(true);
  });

  it('is false when both are set', () => {
    expect(isExactlyOneScope('user-1', 'branch-1')).toBe(false);
  });

  it('is false when neither is set', () => {
    expect(isExactlyOneScope(undefined, undefined)).toBe(false);
    expect(isExactlyOneScope(null, null)).toBe(false);
  });
});

describe('computeAchievementPercent', () => {
  it('rounds to 2dp', () => {
    expect(computeAchievementPercent(7, 20)).toBe(35);
    expect(computeAchievementPercent(1, 3)).toBe(33.33);
  });

  it('can exceed 100 when the target is beaten', () => {
    expect(computeAchievementPercent(25, 20)).toBe(125);
  });

  it('is 0 when nothing has been produced yet', () => {
    expect(computeAchievementPercent(0, 20)).toBe(0);
  });
});

describe('deriveSalesTargetView', () => {
  it('renders dates as ISO strings and passes the rest through', () => {
    expect(deriveSalesTargetView(ROW)).toEqual({
      id: 'target-1',
      ownerUserId: 'user-1',
      branchId: null,
      periodLabel: '2026-Q4',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2027-01-01T00:00:00.000Z',
      targetNewProspects: 20,
      createdByUserId: 'manager-1',
      createdAt: '2026-09-10T09:00:00.000Z',
      updatedAt: '2026-09-10T09:00:00.000Z',
    });
  });
});

describe('salesTargetAuditSnapshot', () => {
  it('carries the scope, period and target figure — no createdByUserId (the actor is already the audit row itself)', () => {
    expect(salesTargetAuditSnapshot(ROW)).toEqual({
      salesTargetId: 'target-1',
      ownerUserId: 'user-1',
      branchId: null,
      periodLabel: '2026-Q4',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2027-01-01T00:00:00.000Z',
      targetNewProspects: 20,
    });
  });
});
