import { describe, expect, it, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { SalesDashboardService } from './sales-dashboard.service';
import type { SalesDashboardRepository } from '../../repositories/sales-dashboard.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    findUserIdsInBranch: vi
      .fn()
      .mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]),
    countNewLeads: vi.fn().mockResolvedValue(20),
    countConvertedToProspectLeads: vi.fn().mockResolvedValue(5),
    sumIssuedPremium: vi.fn().mockResolvedValue('1000.000'),
    sumCommission: vi.fn().mockResolvedValue('200.000'),
    countCrossSellOpportunities: vi.fn().mockResolvedValue(10),
    countCrossSellConverted: vi.fn().mockResolvedValue(3),
    countUpSellRecommendations: vi.fn().mockResolvedValue(4),
    countUpSellConverted: vi.fn().mockResolvedValue(1),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new SalesDashboardService(
    repo as unknown as SalesDashboardRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('SalesDashboardService.resolvePeriod', () => {
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

  it('accepts a full explicit override', () => {
    const { service } = makeService();
    const period = service.resolvePeriod({
      periodLabel: '2026-08',
      periodStart: '2026-08-01',
      periodEnd: '2026-09-01',
    });
    expect(period.periodLabel).toBe('2026-08');
  });

  it('422s periodEnd not after periodStart', () => {
    const { service } = makeService();
    expect(() =>
      service.resolvePeriod({
        periodLabel: '2026-08',
        periodStart: '2026-09-01',
        periodEnd: '2026-08-01',
      }),
    ).toThrow(UnprocessableEntityException);
  });
});

describe('SalesDashboardService.summary', () => {
  it('resolves branchId to concrete user ids and forwards them to every owner-scoped query', async () => {
    const { service, repo } = makeService();
    await service.summary({ branchId: 'branch-1' }, 'u-actor');
    expect(repo.findUserIdsInBranch).toHaveBeenCalledWith('branch-1');
    expect(repo.countNewLeads).toHaveBeenCalledWith(
      ['u-1', 'u-2'],
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('does not resolve a branch when none is given', async () => {
    const { service, repo } = makeService();
    await service.summary({}, 'u-actor');
    expect(repo.findUserIdsInBranch).not.toHaveBeenCalled();
    expect(repo.countNewLeads).toHaveBeenCalledWith(
      undefined,
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('queries both renewal flags for premium written', async () => {
    const { service, repo } = makeService();
    await service.summary({}, 'u-actor');
    expect(repo.sumIssuedPremium).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Date),
      expect.any(Date),
      false,
    );
    expect(repo.sumIssuedPremium).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Date),
      expect.any(Date),
      true,
    );
  });

  it('forwards insuranceLine to cross-sell counts but not to up-sell (no line dimension)', async () => {
    const { service, repo } = makeService();
    await service.summary({ insuranceLine: 'Property' }, 'u-actor');
    expect(repo.countCrossSellOpportunities).toHaveBeenCalledWith(
      'Property',
      expect.any(Date),
      expect.any(Date),
    );
    expect(repo.countUpSellRecommendations).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('records a READ audit row keyed by periodLabel', async () => {
    const { service, audit } = makeService();
    await service.summary({}, 'u-actor');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-actor',
        action: 'READ',
        entityType: 'SalesDashboard',
      }),
    );
  });
});
