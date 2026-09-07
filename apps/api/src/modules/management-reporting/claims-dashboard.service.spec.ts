import { describe, expect, it, vi } from 'vitest';
import { ClaimsDashboardService } from './claims-dashboard.service';
import type { ClaimsDashboardRepository } from '../../repositories/claims-dashboard.repository';
import type { LossRatioRepository } from '../../repositories/loss-ratio.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(
  over: {
    repo?: Record<string, unknown>;
    lossRatioRepo?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    findUserIdsInBranch: vi
      .fn()
      .mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]),
    countClosed: vi.fn().mockResolvedValue(4),
    findOpenClaimsForAgeing: vi.fn().mockResolvedValue([
      {
        id: 'c-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        estimatedLoss: '1000.000',
        netSettlement: null,
      },
    ]),
    ...over.repo,
  };
  const lossRatioRepo = {
    loadPoliciesForAnalytics: vi.fn().mockResolvedValue([]),
    ...over.lossRatioRepo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ClaimsDashboardService(
    repo as unknown as ClaimsDashboardRepository,
    lossRatioRepo as unknown as LossRatioRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, lossRatioRepo, audit };
}

describe('ClaimsDashboardService.summary', () => {
  it('defaults asOf to today (UTC midnight) when not given', async () => {
    const { service, repo } = makeService();
    const summary = await service.summary({}, 'u-actor');
    expect(summary.asOf).toMatch(/T00:00:00\.000Z$/);
    const call = repo.countClosed.mock.calls[0] as [unknown, Date];
    expect(call[1].getTime()).toBeGreaterThan(new Date(summary.asOf).getTime());
  });

  it('parses an explicit asOf and rejects a future one', async () => {
    const { service } = makeService();
    const summary = await service.summary({ asOf: '2026-08-15' }, 'u-actor');
    expect(summary.asOf).toBe('2026-08-15T00:00:00.000Z');

    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const futureStr = future.toISOString().slice(0, 10);
    const { service: service2 } = makeService();
    await expect(
      service2.summary({ asOf: futureStr }, 'u-actor'),
    ).rejects.toThrow();
  });

  it('resolves branchId to concrete user ids and forwards them to every owner-scoped query', async () => {
    const { service, repo, lossRatioRepo } = makeService();
    await service.summary({ branchId: 'branch-1' }, 'u-actor');
    expect(repo.findUserIdsInBranch).toHaveBeenCalledWith('branch-1');
    expect(repo.countClosed).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
      expect.any(Date),
    );
    expect(lossRatioRepo.loadPoliciesForAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
  });

  it('does not resolve a branch when none is given', async () => {
    const { service, repo } = makeService();
    await service.summary({}, 'u-actor');
    expect(repo.findUserIdsInBranch).not.toHaveBeenCalled();
    expect(repo.countClosed).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: undefined }),
      expect.any(Date),
    );
  });

  it('composes closed count, open claims, and loss-ratio policies into one summary', async () => {
    const { service } = makeService();
    const summary = await service.summary({}, 'u-actor');
    expect(summary.closedClaimsCount).toBe(4);
    expect(summary.openClaimsCount).toBe(1);
    expect(summary.outstandingClaimsValueJod).toBe('1000.000');
  });

  it('records a READ audit row keyed by asOf, as sensitive data access, with counts only', async () => {
    const { service, audit } = makeService();
    await service.summary({}, 'u-actor');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-actor',
        action: 'READ',
        entityType: 'ClaimsDashboard',
        isSensitiveDataAccess: true,
      }),
    );
    const call = audit.record.mock.calls[0][0] as {
      afterValue: Record<string, unknown>;
    };
    expect(call.afterValue.openClaimsCount).toBe(1);
    expect(call.afterValue.closedClaimsCount).toBe(4);
  });
});
