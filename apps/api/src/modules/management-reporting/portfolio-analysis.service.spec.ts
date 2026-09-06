import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { PortfolioAnalysisService } from './portfolio-analysis.service';
import type { PortfolioAnalysisRepository } from '../../repositories/portfolio-analysis.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
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
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PortfolioAnalysisService(
    repo as unknown as PortfolioAnalysisRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('PortfolioAnalysisService.summary', () => {
  it('composes all four breakdowns, resolving insurer and branch names', async () => {
    const { service } = makeService();
    const summary = await service.summary('actor-1');

    expect(summary.byLine).toEqual([
      { key: 'motor', policyCount: 2, totalIssuedPremiumJod: '4000.000' },
    ]);
    expect(summary.byInsurer).toEqual([
      {
        key: 'Jordan Insurance Co',
        policyCount: 2,
        totalIssuedPremiumJod: '4000.000',
      },
    ]);
    expect(summary.byClientSegment).toEqual([
      { key: 'CORPORATE', policyCount: 1, totalIssuedPremiumJod: '4000.000' },
    ]);
    expect(summary.byGeography).toEqual([
      {
        key: 'Amman Branch',
        policyCount: 1,
        totalIssuedPremiumJod: '4000.000',
      },
    ]);
    expect(typeof summary.generatedAt).toBe('string');
  });

  it('fires the three top-level queries concurrently, not sequentially', async () => {
    const { service, repo } = makeService();
    await service.summary('actor-1');
    expect(repo.groupByLine).toHaveBeenCalledTimes(1);
    expect(repo.groupByInsurerId).toHaveBeenCalledTimes(1);
    expect(repo.findPoliciesForCrossTableGrouping).toHaveBeenCalledTimes(1);
  });

  it('warns when the cross-table read hits the truncation limit', async () => {
    const { service, repo } = makeService({
      repo: {
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
    await service.summary('actor-1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    expect(repo.findPoliciesForCrossTableGrouping).toHaveBeenCalledWith(5000);
  });

  it('writes a best-effort READ audit row', async () => {
    const { service, audit } = makeService();
    await service.summary('actor-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'READ',
        entityType: 'PortfolioAnalysis',
        entityId: 'summary',
      }),
    );
  });

  it('does not fail the read if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.summary('actor-1')).resolves.toBeDefined();
  });
});
