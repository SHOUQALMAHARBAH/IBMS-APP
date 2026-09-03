import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { ClientAccountingService } from './client-accounting.service';
import type { InvoiceRepository } from '../../repositories/invoice.repository';
import type { OutstandingInvoiceRow } from './finance.config';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(rows: OutstandingInvoiceRow[]) {
  const invoices = {
    loadOutstandingReceivables: vi.fn().mockResolvedValue(rows),
  };
  const service = new ClientAccountingService(
    invoices as unknown as InvoiceRepository,
  );
  return { service, invoices };
}

const outstanding = (
  customerId: string,
  totalAmount: string,
  dueDate: Date,
): OutstandingInvoiceRow => ({
  id: `inv-${customerId}-${dueDate.getTime()}`,
  customerId,
  customerLegalName: `Customer ${customerId}`,
  totalAmount: new Prisma.Decimal(totalAmount),
  currency: 'JOD',
  dueDate,
});

describe('ClientAccountingService.receivablesAgeing (Process 33)', () => {
  it('passes the customerId scope through and asks for invoices as at end of the reference day', async () => {
    const { service, invoices } = makeService([]);
    await service.receivablesAgeing({
      customerId: 'cust-1',
      asOf: '2026-07-31',
    });

    expect(invoices.loadOutstandingReceivables).toHaveBeenCalledTimes(1);
    const arg = invoices.loadOutstandingReceivables.mock.calls[0]?.[0] as {
      customerId?: string;
      asOfExclusiveUpper: Date;
    };
    expect(arg.customerId).toBe('cust-1');
    // the day AFTER 2026-07-31, UTC midnight — the exclusive upper bound
    expect(arg.asOfExclusiveUpper.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('defaults asOf to today when none is given', async () => {
    const { service, invoices } = makeService([]);
    const before = Date.now();
    const report = await service.receivablesAgeing({});
    const after = Date.now();

    const arg = invoices.loadOutstandingReceivables.mock.calls[0]?.[0] as {
      asOfExclusiveUpper: Date;
    };
    const todayMidnight = new Date(
      Date.UTC(
        new Date(before).getUTCFullYear(),
        new Date(before).getUTCMonth(),
        new Date(before).getUTCDate(),
      ),
    ).getTime();
    expect(arg.asOfExclusiveUpper.getTime()).toBe(todayMidnight + DAY_MS);
    // the report echoes today's UTC midnight
    expect(report.asOf).toBe(new Date(todayMidnight).toISOString());
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('422s a future asOf (an ageing report of the future is meaningless)', async () => {
    const { service } = makeService([]);
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
    await expect(service.receivablesAgeing({ asOf: tomorrow })).rejects.toThrow(
      /future/i,
    );
  });

  it('422s an asOf that is not a real calendar date', async () => {
    const { service } = makeService([]);
    await expect(
      service.receivablesAgeing({ asOf: '2026-13-99' }),
    ).rejects.toThrow();
  });

  it('builds the ageing report from the loaded rows', async () => {
    const asOf = '2026-09-03';
    const midnight = Date.UTC(2026, 8, 3);
    const { service } = makeService([
      outstanding('acme', '1000.000', new Date(midnight - 95 * DAY_MS)),
      outstanding('acme', '250.000', new Date(midnight + 10 * DAY_MS)),
      outstanding('beta', '500.000', new Date(midnight - 20 * DAY_MS)),
    ]);

    const report = await service.receivablesAgeing({ asOf });

    expect(report.asOf).toBe('2026-09-03T00:00:00.000Z');
    // acme's oldest debt (95d) sorts it ahead of beta (20d)
    expect(report.rows.map((r) => r.customerId)).toEqual(['acme', 'beta']);
    expect(report.rows[0]).toMatchObject({
      customerId: 'acme',
      current: '250.000',
      d90_plus: '1000.000',
      outstandingTotal: '1250.000',
      invoiceCount: 2,
      oldestDaysOverdue: 95,
    });
    expect(report.rows[1]).toMatchObject({
      customerId: 'beta',
      d1_30: '500.000',
      outstandingTotal: '500.000',
    });
    expect(report.totals).toMatchObject({
      outstandingTotal: '1750.000',
      invoiceCount: 3,
      customerCount: 2,
    });
  });
});
