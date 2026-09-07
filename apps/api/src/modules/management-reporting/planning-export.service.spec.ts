import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { PlanningExportService } from './planning-export.service';
import type { PortfolioAnalysisRepository } from '../../repositories/portfolio-analysis.repository';
import type { InsurerPerformanceRepository } from '../../repositories/insurer-performance.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(
  over: {
    portfolioRepo?: Record<string, unknown>;
    insurerPerformanceRepo?: Record<string, unknown>;
  } = {},
) {
  const portfolioRepo = {
    groupByLine: vi.fn().mockResolvedValue([
      {
        key: 'motor',
        policyCount: 2,
        totalIssuedPremium: new Prisma.Decimal('4000'),
      },
    ]),
    groupByInsurerId: vi.fn().mockResolvedValue([
      {
        key: 'insurer-1',
        policyCount: 2,
        totalIssuedPremium: new Prisma.Decimal('4000'),
      },
    ]),
    findInsurerNames: vi
      .fn()
      .mockResolvedValue([{ id: 'insurer-1', name: 'Jordan Insurance Co' }]),
    findPoliciesForCrossTableGrouping: vi.fn().mockResolvedValue([
      {
        issuedPremium: new Prisma.Decimal('4000'),
        customerType: 'CORPORATE',
        ownerUserId: 'user-1',
      },
    ]),
    findBranchNamesForOwners: vi
      .fn()
      .mockResolvedValue(new Map([['user-1', 'Amman Branch']])),
    ...over.portfolioRepo,
  };
  const insurerPerformanceRepo = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'score-1',
        insurerId: 'insurer-1',
        periodLabel: '2026-08',
        quoteResponseScore: new Prisma.Decimal('90.00'),
        claimsServiceScore: new Prisma.Decimal('80.00'),
        priceScore: new Prisma.Decimal('70.00'),
        serviceQualityScore: new Prisma.Decimal('60.00'),
        computedAt: new Date('2026-09-01T06:00:00.000Z'),
      },
    ]),
    ...over.insurerPerformanceRepo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PlanningExportService(
    portfolioRepo as unknown as PortfolioAnalysisRepository,
    insurerPerformanceRepo as unknown as InsurerPerformanceRepository,
    audit as unknown as AuditService,
  );
  return { service, portfolioRepo, insurerPerformanceRepo, audit };
}

describe('PlanningExportService.generate', () => {
  it('composes portfolio + market data for the resolved period', async () => {
    const { service } = makeService();
    const summary = await service.generate('actor-1', '2026-08');

    expect(summary.periodLabel).toBe('2026-08');
    expect(summary.portfolio.byLine).toEqual([
      { key: 'motor', policyCount: 2, totalIssuedPremiumJod: '4000.000' },
    ]);
    expect(summary.portfolio.byInsurer).toEqual([
      {
        key: 'Jordan Insurance Co',
        policyCount: 2,
        totalIssuedPremiumJod: '4000.000',
      },
    ]);
    expect(summary.portfolio.byClientSegment).toEqual([
      { key: 'CORPORATE', policyCount: 1, totalIssuedPremiumJod: '4000.000' },
    ]);
    expect(summary.portfolio.byGeography).toEqual([
      {
        key: 'Amman Branch',
        policyCount: 1,
        totalIssuedPremiumJod: '4000.000',
      },
    ]);
    expect(summary.market).toEqual([
      {
        id: 'score-1',
        insurerId: 'insurer-1',
        periodLabel: '2026-08',
        quoteResponseScore: '90.00',
        claimsServiceScore: '80.00',
        priceScore: '70.00',
        serviceQualityScore: '60.00',
        computedAt: '2026-09-01T06:00:00.000Z',
      },
    ]);
    expect(typeof summary.generatedAt).toBe('string');
  });

  it('defaults the market period to the previous UTC calendar month when none is given', async () => {
    const { service, insurerPerformanceRepo } = makeService();
    await service.generate('actor-1', undefined);
    const [arg] = insurerPerformanceRepo.findMany.mock.calls[0] as [
      { periodLabel: string },
    ];
    expect(arg.periodLabel).toMatch(/^\d{4}-\d{2}$/);
  });

  it('fires the four independent reads concurrently, not sequentially', async () => {
    const { service, portfolioRepo, insurerPerformanceRepo } = makeService();
    await service.generate('actor-1', '2026-08');
    expect(portfolioRepo.groupByLine).toHaveBeenCalledTimes(1);
    expect(portfolioRepo.groupByInsurerId).toHaveBeenCalledTimes(1);
    expect(
      portfolioRepo.findPoliciesForCrossTableGrouping,
    ).toHaveBeenCalledTimes(1);
    expect(insurerPerformanceRepo.findMany).toHaveBeenCalledTimes(1);
  });

  it('warns when the cross-table read hits the truncation limit', async () => {
    const { service, portfolioRepo } = makeService({
      portfolioRepo: {
        findPoliciesForCrossTableGrouping: vi.fn().mockResolvedValue(
          Array.from({ length: 5000 }, () => ({
            issuedPremium: new Prisma.Decimal('100'),
            customerType: 'INDIVIDUAL',
            ownerUserId: 'user-x',
          })),
        ),
        findBranchNamesForOwners: vi
          .fn()
          .mockResolvedValue(new Map([['user-x', null]])),
      },
    });
    const warnSpy = vi.spyOn(service['logger'], 'warn');
    await service.generate('actor-1', '2026-08');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    expect(
      portfolioRepo.findPoliciesForCrossTableGrouping,
    ).toHaveBeenCalledWith(5000);
  });

  it('writes a best-effort EXPORT audit row', async () => {
    const { service, audit } = makeService();
    await service.generate('actor-1', '2026-08');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'EXPORT',
        entityType: 'PlanningExport',
        entityId: '2026-08',
      }),
    );
  });

  it('does not fail the export if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.generate('actor-1', '2026-08')).resolves.toBeDefined();
  });
});
