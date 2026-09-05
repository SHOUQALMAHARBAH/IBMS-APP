import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { KpiDashboardService } from './kpi-dashboard.service';
import type { KpiDashboardRepository } from '../../repositories/kpi-dashboard.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    countCustomers: vi.fn().mockResolvedValue(42),
    countByStatus: vi.fn().mockResolvedValue([{ status: 'open', count: 2 }]),
    countOpenServiceRequests: vi.fn().mockResolvedValue(3),
    countOpenRiskRegisterItems: vi.fn().mockResolvedValue(1),
    countOpenIncidents: vi.fn().mockResolvedValue(0),
    countOpenInternalAuditFindings: vi.fn().mockResolvedValue(2),
    sumIssuedPremium: vi.fn().mockResolvedValue(new Prisma.Decimal('50000')),
    sumOutstandingInvoiced: vi
      .fn()
      .mockResolvedValue(new Prisma.Decimal('1200.500')),
    sumCommissionSince: vi.fn().mockResolvedValue(null),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new KpiDashboardService(
    repo as unknown as KpiDashboardRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('KpiDashboardService.summary (Process 58)', () => {
  it('aggregates every domain into the summary shape', async () => {
    const { service } = makeService();
    const summary = await service.summary('u-manager');

    expect(summary.sales.totalCustomers).toBe(42);
    expect(summary.sales.leadsByStatus).toEqual({ open: 2 });
    expect(summary.policy.totalIssuedPremiumJod).toBe('50000.000');
    expect(summary.finance.outstandingInvoicedJod).toBe('1200.500');
    expect(summary.finance.commissionThisMonthJod).toBe('0.000');
    expect(summary.customerService.openServiceRequests).toBe(3);
    expect(summary.complianceRisk.openRiskRegisterItems).toBe(1);
    expect(summary.complianceRisk.openIncidents).toBe(0);
    expect(summary.complianceRisk.openInternalAuditFindings).toBe(2);
    expect(typeof summary.generatedAt).toBe('string');
  });

  it('calls countByStatus once per domain that needs a status breakdown', async () => {
    const { service, repo } = makeService();
    await service.summary('u-manager');
    expect(repo.countByStatus).toHaveBeenCalledWith('lead');
    expect(repo.countByStatus).toHaveBeenCalledWith('prospect');
    expect(repo.countByStatus).toHaveBeenCalledWith('opportunity');
    expect(repo.countByStatus).toHaveBeenCalledWith('policy');
    expect(repo.countByStatus).toHaveBeenCalledWith('claim');
    expect(repo.countByStatus).toHaveBeenCalledWith('invoice');
    expect(repo.countByStatus).toHaveBeenCalledWith('complaint');
  });

  it('writes a best-effort READ audit row', async () => {
    const { service, audit } = makeService();
    await service.summary('u-manager');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-manager',
        action: 'READ',
        entityType: 'KpiDashboard',
        entityId: 'summary',
      }),
    );
  });

  it('does not fail the read if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.summary('u-manager')).resolves.toBeDefined();
  });
});
