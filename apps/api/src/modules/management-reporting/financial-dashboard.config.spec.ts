import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import { buildFinancialDashboardSummary } from './financial-dashboard.config';
import type { ProfitabilityPolicyRow } from '../../repositories/profitability-policy.repository';
import type {
  CommissionRollupEntryRow,
  InsurerObligationRow,
  InsurerRemittanceRow,
  OutstandingInvoiceRow,
} from '../finance/finance.config';

const d = (s: string) => new Prisma.Decimal(s);

describe('buildFinancialDashboardSummary', () => {
  it('composes receivables, payables, commission, and profitability from raw rows', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const asOf = new Date('2026-09-01T00:00:00.000Z');

    const outstandingInvoices: OutstandingInvoiceRow[] = [
      {
        id: 'inv-1',
        customerId: 'cus-1',
        customerLegalName: 'Acme Ltd',
        totalAmount: d('1000.000'),
        outstandingAmount: d('1000.000'),
        currency: 'JOD',
        dueDate: new Date('2026-08-15T00:00:00.000Z'),
      },
    ];
    const obligations: InsurerObligationRow[] = [
      {
        invoiceId: 'inv-2',
        insurerId: 'ins-1',
        insurerName: 'National Insurance',
        premiumAmount: d('2000.000'),
        commissionDeducted: d('200.000'),
        collectedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ];
    const remittances: InsurerRemittanceRow[] = [
      {
        remittanceId: 'rem-1',
        insurerId: 'ins-1',
        insurerName: 'National Insurance',
        amount: d('900.000'),
        remittedAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    ];
    const commissionEntries: CommissionRollupEntryRow[] = [
      {
        entryId: 'ce-1',
        insurerId: 'ins-1',
        insurerName: 'National Insurance',
        amount: d('300.000'),
        vatAmount: d('0.000'),
        paidAmount: d('100.000'),
        reversedAmount: null,
        status: 'outstanding',
      },
    ];
    const profitabilityPolicies: ProfitabilityPolicyRow[] = [
      {
        policyId: 'pol-1',
        insuranceLine: 'motor',
        customerType: 'CORPORATE',
        premium: d('4000.000'),
        claimNetSettlements: [d('1000.000')],
        commissionAmount: d('300.000'),
        commissionReversedAmount: null,
      },
    ];

    const summary = buildFinancialDashboardSummary({
      now,
      asOf,
      outstandingInvoices,
      obligations,
      remittances,
      commissionEntries,
      profitabilityPolicies,
    });

    expect(summary.generatedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(summary.asOf).toBe('2026-09-01T00:00:00.000Z');
    expect(summary.currency).toBe('JOD');
    expect(summary.receivables.totals.invoiceCount).toBe(1);
    expect(summary.receivables.totals.outstandingTotal).toBe('1000.000');
    expect(summary.payables.totals.outstandingCount).toBe(1);
    expect(summary.payables.totals.remittedAmount).toBe('900.000');
    expect(summary.commission.earned).toBe('300.000');
    expect(summary.commission.outstanding).toBe('200.000'); // 300 - 100 paid
    expect(summary.profitability.byLine).toHaveLength(1);
    expect(summary.profitability.byLine[0]).toMatchObject({
      key: 'motor',
      premiumWritten: '4000.000',
      claimsPaid: '1000.000',
      commissionEarned: '300.000',
      netPosition: '2700.000',
    });
    expect(summary.profitability.bySegment[0]).toMatchObject({
      key: 'CORPORATE',
    });
  });

  it('returns zeroed sections for no data anywhere', () => {
    const summary = buildFinancialDashboardSummary({
      now: new Date('2026-09-07T00:00:00.000Z'),
      asOf: new Date('2026-09-01T00:00:00.000Z'),
      outstandingInvoices: [],
      obligations: [],
      remittances: [],
      commissionEntries: [],
      profitabilityPolicies: [],
    });
    expect(summary.receivables.totals.invoiceCount).toBe(0);
    expect(summary.payables.totals.insurerCount).toBe(0);
    expect(summary.commission.entryCount).toBe(0);
    expect(summary.profitability.totals.policyCount).toBe(0);
  });
});
