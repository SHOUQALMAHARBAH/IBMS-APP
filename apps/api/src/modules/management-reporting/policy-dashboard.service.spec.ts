import { describe, expect, it, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { PolicyDashboardService } from './policy-dashboard.service';
import type { PolicyDashboardRepository } from '../../repositories/policy-dashboard.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    findUserIdsInBranch: vi
      .fn()
      .mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]),
    countActive: vi.fn().mockResolvedValue(100),
    countExpiringWithinWindow: vi.fn().mockResolvedValue(10),
    countNewlyIssued: vi.fn().mockResolvedValue(5),
    findCancelledInPeriod: vi.fn().mockResolvedValue([
      {
        policyId: 'pol-1',
        policyNumber: 'POL-1',
        insuranceLine: 'property',
        reason: 'Non-renewal by client.',
        appliedAt: new Date('2026-08-15T00:00:00.000Z'),
      },
    ]),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PolicyDashboardService(
    repo as unknown as PolicyDashboardRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('PolicyDashboardService.resolvePeriod', () => {
  it('defaults to the previous UTC calendar month when no period fields are given', () => {
    const { service } = makeService();
    const period = service.resolvePeriod({});
    expect(period.periodLabel).toMatch(/^\d{4}-\d{2}$/);
  });

  it('422s a partial period override', () => {
    const { service } = makeService();
    expect(() => service.resolvePeriod({ periodLabel: '2026-08' })).toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('PolicyDashboardService.summary', () => {
  it('defaults renewalWindowDays to 90 when not given', async () => {
    const { service, repo } = makeService();
    await service.summary({}, 'u-actor');
    const call = repo.countExpiringWithinWindow.mock.calls[0] as [
      unknown,
      Date,
      Date,
    ];
    const daysDiff = Math.round(
      (call[2].getTime() - call[1].getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(daysDiff).toBe(90);
  });

  it('honors a caller-supplied renewalWindowDays', async () => {
    const { service, repo } = makeService();
    await service.summary({ renewalWindowDays: 30 }, 'u-actor');
    const call = repo.countExpiringWithinWindow.mock.calls[0] as [
      unknown,
      Date,
      Date,
    ];
    const daysDiff = Math.round(
      (call[2].getTime() - call[1].getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(daysDiff).toBe(30);
  });

  it('resolves branchId to concrete user ids and forwards them to every owner-scoped query', async () => {
    const { service, repo } = makeService();
    await service.summary({ branchId: 'branch-1' }, 'u-actor');
    expect(repo.findUserIdsInBranch).toHaveBeenCalledWith('branch-1');
    expect(repo.countActive).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
  });

  it('does not resolve a branch when none is given', async () => {
    const { service, repo } = makeService();
    await service.summary({}, 'u-actor');
    expect(repo.findUserIdsInBranch).not.toHaveBeenCalled();
    expect(repo.countActive).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: undefined }),
    );
  });

  it('maps cancelled rows to the view shape, using appliedAt as cancelledAt', async () => {
    const { service } = makeService();
    const summary = await service.summary({}, 'u-actor');
    expect(summary.cancelledPolicies).toEqual([
      {
        policyId: 'pol-1',
        policyNumber: 'POL-1',
        insuranceLine: 'property',
        reason: 'Non-renewal by client.',
        cancelledAt: '2026-08-15T00:00:00.000Z',
      },
    ]);
  });

  it('records a READ audit row keyed by periodLabel, with counts only (no reason text)', async () => {
    const { service, audit } = makeService();
    await service.summary({}, 'u-actor');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-actor',
        action: 'READ',
        entityType: 'PolicyDashboard',
      }),
    );
    const call = audit.record.mock.calls[0][0] as {
      afterValue: Record<string, unknown>;
    };
    expect(call.afterValue.cancelledPoliciesCount).toBe(1);
    expect(JSON.stringify(call.afterValue)).not.toContain('Non-renewal');
  });
});
