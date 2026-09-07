import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { ProfitabilityAnalysisService } from './profitability-analysis.service';
import type { ProfitabilityPolicyRepository } from '../../repositories/profitability-policy.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    loadWrittenPolicies: vi.fn().mockResolvedValue([
      {
        policyId: 'pol-1',
        insuranceLine: 'Motor',
        customerType: 'CORPORATE',
        premium: new Prisma.Decimal('10000.000'),
        claimNetSettlements: [new Prisma.Decimal('400.000')],
        commissionAmount: new Prisma.Decimal('1000.000'),
        commissionReversedAmount: null,
      },
    ]),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ProfitabilityAnalysisService(
    repo as unknown as ProfitabilityPolicyRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('ProfitabilityAnalysisService.summary', () => {
  it('composes byLine/bySegment/totals from the written-policy read', async () => {
    const { service } = makeService();
    const summary = await service.summary('actor-1');

    expect(summary.byLine).toEqual([
      {
        key: 'Motor',
        commissionIncomeJod: '1000.000',
        costToServeJod: '400.000',
        netProfitabilityJod: '600.000',
        policyCount: 1,
        claimCount: 1,
      },
    ]);
    expect(summary.bySegment[0]).toMatchObject({ key: 'CORPORATE' });
    expect(summary.totals).toMatchObject({
      commissionIncomeJod: '1000.000',
      costToServeJod: '400.000',
      netProfitabilityJod: '600.000',
    });
    expect(typeof summary.generatedAt).toBe('string');
  });

  it('warns when the written-policy read hits the truncation limit', async () => {
    const { service, repo } = makeService({
      repo: {
        loadWrittenPolicies: vi.fn().mockResolvedValue(
          Array.from({ length: 5000 }, (_, i) => ({
            policyId: `pol-${i}`,
            insuranceLine: 'Motor',
            customerType: 'INDIVIDUAL',
            premium: new Prisma.Decimal('100.000'),
            claimNetSettlements: [],
            commissionAmount: null,
            commissionReversedAmount: null,
          })),
        ),
      },
    });
    const warnSpy = vi.spyOn(service['logger'], 'warn');
    await service.summary('actor-1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    expect(repo.loadWrittenPolicies).toHaveBeenCalledWith(5000);
  });

  it('writes a best-effort READ audit row, flagged sensitive when a claim contributed', async () => {
    const { service, audit } = makeService();
    await service.summary('actor-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'READ',
        entityType: 'ProfitabilityAnalysis',
        entityId: 'summary',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('is NOT flagged sensitive when no claim contributed', async () => {
    const { service, audit } = makeService({
      repo: {
        loadWrittenPolicies: vi.fn().mockResolvedValue([
          {
            policyId: 'pol-2',
            insuranceLine: 'Motor',
            customerType: 'CORPORATE',
            premium: new Prisma.Decimal('5000.000'),
            claimNetSettlements: [],
            commissionAmount: new Prisma.Decimal('500.000'),
            commissionReversedAmount: null,
          },
        ]),
      },
    });
    await service.summary('actor-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ isSensitiveDataAccess: false }),
    );
  });

  it('does not fail the read if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.summary('actor-1')).resolves.toBeDefined();
  });
});
