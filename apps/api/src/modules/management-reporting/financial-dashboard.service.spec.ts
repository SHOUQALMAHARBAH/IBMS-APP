import { describe, expect, it, vi } from 'vitest';
import { FinancialDashboardService } from './financial-dashboard.service';
import type { FinancialDashboardRepository } from '../../repositories/financial-dashboard.repository';
import type { InvoiceRepository } from '../../repositories/invoice.repository';
import type { FinancialReportRepository } from '../../repositories/financial-report.repository';
import type { ProfitabilityPolicyRepository } from '../../repositories/profitability-policy.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(
  over: {
    repo?: Record<string, unknown>;
    invoices?: Record<string, unknown>;
    financialReportRepo?: Record<string, unknown>;
    profitabilityPolicyRepo?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    findUserIdsInBranch: vi
      .fn()
      .mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]),
    ...over.repo,
  };
  const invoices = {
    loadOutstandingReceivables: vi.fn().mockResolvedValue([]),
    loadInsurerObligations: vi.fn().mockResolvedValue([]),
    loadInsurerRemittances: vi.fn().mockResolvedValue([]),
    ...over.invoices,
  };
  const financialReportRepo = {
    loadCommissionRollupEntries: vi.fn().mockResolvedValue([]),
    ...over.financialReportRepo,
  };
  const profitabilityPolicyRepo = {
    loadWrittenPolicies: vi.fn().mockResolvedValue([]),
    ...over.profitabilityPolicyRepo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new FinancialDashboardService(
    repo as unknown as FinancialDashboardRepository,
    invoices as unknown as InvoiceRepository,
    financialReportRepo as unknown as FinancialReportRepository,
    profitabilityPolicyRepo as unknown as ProfitabilityPolicyRepository,
    audit as unknown as AuditService,
  );
  return {
    service,
    repo,
    invoices,
    financialReportRepo,
    profitabilityPolicyRepo,
    audit,
  };
}

describe('FinancialDashboardService.summary', () => {
  it('defaults asOf to today (UTC midnight) when not given', async () => {
    const { service } = makeService();
    const summary = await service.summary({}, 'u-actor');
    expect(summary.asOf).toMatch(/T00:00:00\.000Z$/);
  });

  it('parses an explicit asOf and rejects a future one', async () => {
    const { service } = makeService();
    const summary = await service.summary({ asOf: '2026-08-15' }, 'u-actor');
    expect(summary.asOf).toBe('2026-08-15T00:00:00.000Z');

    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { service: service2 } = makeService();
    await expect(
      service2.summary({ asOf: future }, 'u-actor'),
    ).rejects.toThrow();
  });

  it('resolves branchId to concrete user ids and forwards them to every owner-scoped query', async () => {
    const {
      service,
      repo,
      invoices,
      financialReportRepo,
      profitabilityPolicyRepo,
    } = makeService();
    await service.summary({ branchId: 'branch-1' }, 'u-actor');
    expect(repo.findUserIdsInBranch).toHaveBeenCalledWith('branch-1');
    expect(invoices.loadOutstandingReceivables).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
    expect(invoices.loadInsurerObligations).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
    expect(
      financialReportRepo.loadCommissionRollupEntries,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
    expect(profitabilityPolicyRepo.loadWrittenPolicies).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
  });

  it('does not resolve a branch when none is given, and never passes ownerUserIds/insuranceLine/branch to remittances', async () => {
    const { service, repo, invoices } = makeService();
    await service.summary({}, 'u-actor');
    expect(repo.findUserIdsInBranch).not.toHaveBeenCalled();
    const remittanceCall = invoices.loadInsurerRemittances.mock
      .calls[0][0] as Record<string, unknown>;
    expect(remittanceCall).not.toHaveProperty('ownerUserIds');
    expect(remittanceCall).not.toHaveProperty('insuranceLine');
  });

  it('composes every section into one summary', async () => {
    const { service } = makeService({
      invoices: {
        loadOutstandingReceivables: vi.fn().mockResolvedValue([
          {
            id: 'inv-1',
            customerId: 'cus-1',
            customerLegalName: 'Acme Ltd',
            totalAmount: '500.000',
            currency: 'JOD',
            dueDate: new Date('2026-08-01T00:00:00.000Z'),
          },
        ]),
        loadInsurerObligations: vi.fn().mockResolvedValue([]),
        loadInsurerRemittances: vi.fn().mockResolvedValue([]),
      },
    });
    const summary = await service.summary({}, 'u-actor');
    expect(summary.receivables.totals.invoiceCount).toBe(1);
    expect(summary.receivables.totals.outstandingTotal).toBe('500.000');
  });

  it('records a READ audit row keyed by asOf, sensitive only when a settled claim contributed', async () => {
    const { service, audit } = makeService();
    await service.summary({}, 'u-actor');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-actor',
        action: 'READ',
        entityType: 'FinancialDashboard',
        isSensitiveDataAccess: false,
      }),
    );
  });
});
