import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { FinancialReportService } from './financial-report.service';
import type { ClientAccountingService } from './client-accounting.service';
import type { InsurerAccountingService } from './insurer-accounting.service';
import type { FinancialReportRepository } from '../../repositories/financial-report.repository';
import type { AuditService } from '../audit/audit.service';
import type {
  CommissionRollupEntryRow,
  ProfitabilityPolicyRow,
} from './finance.config';

const d = (v: string) => new Prisma.Decimal(v);
const DAY_MS = 24 * 60 * 60 * 1000;

const AGEING_TOTALS = {
  current: '1000.000',
  d1_30: '500.000',
  d31_60: '0.000',
  d61_90: '0.000',
  d90_plus: '250.000',
  outstandingTotal: '1750.000',
  invoiceCount: 3,
  customerCount: 2,
};
const PAYABLES_TOTALS = {
  outstandingAmount: '88000.000',
  outstandingCount: 1,
  remittedAmount: '49000.000',
  remittedCount: 2,
  insurerCount: 2,
};

function makeService(
  over: {
    commissionEntries?: CommissionRollupEntryRow[];
    policies?: ProfitabilityPolicyRow[];
  } = {},
) {
  const clientAccounting = {
    receivablesAgeing: vi.fn().mockResolvedValue({
      asOf: '2026-09-03T00:00:00.000Z',
      currency: 'JOD',
      rows: [],
      totals: AGEING_TOTALS,
    }),
  };
  const insurerAccounting = {
    payables: vi.fn().mockResolvedValue({
      asOf: '2026-09-03T00:00:00.000Z',
      currency: 'JOD',
      rows: [],
      totals: PAYABLES_TOTALS,
    }),
  };
  const repo = {
    loadCommissionRollupEntries: vi
      .fn()
      .mockResolvedValue(over.commissionEntries ?? []),
    loadProfitabilityPolicies: vi.fn().mockResolvedValue(over.policies ?? []),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new FinancialReportService(
    clientAccounting as unknown as ClientAccountingService,
    insurerAccounting as unknown as InsurerAccountingService,
    repo as unknown as FinancialReportRepository,
    audit as unknown as AuditService,
  );
  return { service, clientAccounting, insurerAccounting, repo, audit };
}

const commissionEntry = (
  over: Partial<CommissionRollupEntryRow> = {},
): CommissionRollupEntryRow => ({
  entryId: 'cle-1',
  insurerId: 'ins-1',
  insurerName: 'Alpha',
  amount: d('1000.000'),
  vatAmount: d('160.000'),
  paidAmount: null,
  reversedAmount: null,
  status: 'outstanding',
  ...over,
});

const profitPolicy = (
  over: Partial<ProfitabilityPolicyRow> = {},
): ProfitabilityPolicyRow => ({
  policyId: 'pol-1',
  insuranceLine: 'Property All Risks',
  customerType: 'CORPORATE',
  premium: d('120000.000'),
  claimNetSettlements: [],
  commissionAmount: d('14400.000'),
  commissionReversedAmount: null,
  ...over,
});

describe('FinancialReportService.summary (Process 40)', () => {
  it('composes the four sections from #33 / #34 totals + the two builders', async () => {
    const { service } = makeService({
      commissionEntries: [
        commissionEntry({ amount: d('1000.000') }),
        commissionEntry({
          entryId: 'cle-2',
          status: 'paid',
          amount: d('2000.000'),
          paidAmount: d('2000.000'),
        }),
      ],
      policies: [profitPolicy({ claimNetSettlements: [d('20000.000')] })],
    });

    const s = await service.summary({ asOf: '2026-09-03' }, 'fin-1');

    expect(s.asOf).toBe('2026-09-03T00:00:00.000Z');
    expect(s.currency).toBe('JOD');
    expect(s.receivables).toMatchObject({
      outstandingTotal: '1750.000',
      current: '1000.000',
      d90_plus: '250.000',
      invoiceCount: 3,
      customerCount: 2,
    });
    expect(s.payables).toMatchObject({
      outstandingAmount: '88000.000',
      remittedAmount: '49000.000',
      insurerCount: 2,
    });
    expect(s.commission).toMatchObject({
      earned: '3000.000',
      paid: '2000.000',
      outstanding: '1000.000',
      reversed: '0.000',
      entryCount: 2,
    });
    // 120000 - 20000 - 14400
    expect(s.profitability.totals).toMatchObject({
      premiumWritten: '120000.000',
      claimsPaid: '20000.000',
      commissionEarned: '14400.000',
      netPosition: '85600.000',
      policyCount: 1,
      claimCount: 1,
    });
  });

  it('passes the canonical YYYY-MM-DD asOf down to both sub-services', async () => {
    const { service, clientAccounting, insurerAccounting } = makeService();
    await service.summary({ asOf: '2026-07-31' }, 'fin-1');
    expect(clientAccounting.receivablesAgeing).toHaveBeenCalledWith({
      asOf: '2026-07-31',
    });
    expect(insurerAccounting.payables).toHaveBeenCalledWith({
      asOf: '2026-07-31',
    });
  });

  it('defaults asOf to today (UTC midnight) when none is given', async () => {
    const { service } = makeService();
    const before = Date.now();
    const s = await service.summary({}, 'fin-1');
    const todayMidnight = Date.UTC(
      new Date(before).getUTCFullYear(),
      new Date(before).getUTCMonth(),
      new Date(before).getUTCDate(),
    );
    expect(s.asOf).toBe(new Date(todayMidnight).toISOString());
  });

  it('422s a future asOf', async () => {
    const { service } = makeService();
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
    await expect(service.summary({ asOf: tomorrow }, 'fin-1')).rejects.toThrow(
      /future/i,
    );
  });

  it('writes a best-effort READ audit row — flagged sensitive when a settled claim contributed', async () => {
    const { service, audit } = makeService({
      policies: [profitPolicy({ claimNetSettlements: [d('20000.000')] })],
    });
    await service.summary({ asOf: '2026-09-03' }, 'fin-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'FinancialReport',
        entityId: 'summary',
        isSensitiveDataAccess: true,
      }),
    );
    const arg = audit.record.mock.calls[0]?.[0] as {
      afterValue: Record<string, unknown>;
    };
    expect(arg.afterValue).toMatchObject({
      view: 'financial-report-summary',
      settledClaims: 1,
      writtenPolicies: 1,
    });
  });

  it('the READ audit is NOT flagged sensitive when no claim contributed, and a failed audit never breaks the read', async () => {
    const { service, audit } = makeService({
      policies: [profitPolicy({ claimNetSettlements: [] })],
    });
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const s = await service.summary({ asOf: '2026-09-03' }, 'fin-1');
    expect(s.profitability.totals.claimCount).toBe(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ isSensitiveDataAccess: false }),
    );
  });
});
