import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { InsurerAccountingService } from './insurer-accounting.service';
import type { InvoiceRepository } from '../../repositories/invoice.repository';
import type {
  InsurerObligationRow,
  InsurerRemittanceRow,
} from './finance.config';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(
  obligations: InsurerObligationRow[],
  remittances: InsurerRemittanceRow[],
) {
  const invoices = {
    loadInsurerObligations: vi.fn().mockResolvedValue(obligations),
    loadInsurerRemittances: vi.fn().mockResolvedValue(remittances),
  };
  const service = new InsurerAccountingService(
    invoices as unknown as InvoiceRepository,
  );
  return { service, invoices };
}

const obligation = (
  insurerId: string,
  premium: string,
  commission: string,
  collectedAt: Date,
): InsurerObligationRow => ({
  invoiceId: `inv-${insurerId}-${collectedAt.getTime()}`,
  insurerId,
  insurerName: `Insurer ${insurerId}`,
  premiumAmount: new Prisma.Decimal(premium),
  commissionDeducted: new Prisma.Decimal(commission),
  collectedAt,
});

const remittance = (
  insurerId: string,
  amount: string,
  remittedAt: Date,
): InsurerRemittanceRow => ({
  remittanceId: `rem-${insurerId}-${remittedAt.getTime()}`,
  insurerId,
  insurerName: `Insurer ${insurerId}`,
  amount: new Prisma.Decimal(amount),
  remittedAt,
});

describe('InsurerAccountingService.payables (Process 34)', () => {
  it('passes the insurerId scope and the end-of-reference-day upper bound to both repo reads', async () => {
    const { service, invoices } = makeService([], []);
    await service.payables({ insurerId: 'ins-1', asOf: '2026-07-31' });

    for (const fn of [
      invoices.loadInsurerObligations,
      invoices.loadInsurerRemittances,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
      const arg = fn.mock.calls[0]?.[0] as {
        insurerId?: string;
        asOfExclusiveUpper: Date;
      };
      expect(arg.insurerId).toBe('ins-1');
      expect(arg.asOfExclusiveUpper.toISOString()).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    }
  });

  it('defaults asOf to today when none is given', async () => {
    const { service, invoices } = makeService([], []);
    const before = Date.now();
    const report = await service.payables({});

    const arg = invoices.loadInsurerObligations.mock.calls[0]?.[0] as {
      asOfExclusiveUpper: Date;
    };
    const todayMidnight = Date.UTC(
      new Date(before).getUTCFullYear(),
      new Date(before).getUTCMonth(),
      new Date(before).getUTCDate(),
    );
    expect(arg.asOfExclusiveUpper.getTime()).toBe(todayMidnight + DAY_MS);
    expect(report.asOf).toBe(new Date(todayMidnight).toISOString());
  });

  it('422s a future asOf', async () => {
    const { service } = makeService([], []);
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
    await expect(service.payables({ asOf: tomorrow })).rejects.toThrow(
      /future/i,
    );
  });

  it('422s an asOf that is not a real calendar date', async () => {
    const { service } = makeService([], []);
    await expect(service.payables({ asOf: '2026-13-99' })).rejects.toThrow();
  });

  it('builds the payables report from the loaded obligation + remittance rows', async () => {
    const midnight = Date.UTC(2026, 8, 3);
    const { service } = makeService(
      [
        obligation(
          'acme',
          '100000.000',
          '12000.000',
          new Date(midnight - 12 * DAY_MS),
        ),
      ],
      [
        remittance('acme', '44000.000', new Date(midnight - 30 * DAY_MS)),
        remittance('beta', '5000.000', new Date(midnight - 3 * DAY_MS)),
      ],
    );

    const report = await service.payables({ asOf: '2026-09-03' });

    expect(report.asOf).toBe('2026-09-03T00:00:00.000Z');
    // acme has an outstanding obligation -> sorts ahead of the remitted-only beta
    expect(report.rows.map((r) => r.insurerId)).toEqual(['acme', 'beta']);
    expect(report.rows[0]).toMatchObject({
      insurerId: 'acme',
      outstandingAmount: '88000.000', // 100000 - 12000
      outstandingCount: 1,
      oldestDaysOutstanding: 12,
      remittedAmount: '44000.000',
      remittedCount: 1,
    });
    expect(report.rows[1]).toMatchObject({
      insurerId: 'beta',
      outstandingAmount: '0.000',
      remittedAmount: '5000.000',
    });
    expect(report.totals).toMatchObject({
      outstandingAmount: '88000.000',
      outstandingCount: 1,
      remittedAmount: '49000.000',
      remittedCount: 2,
      insurerCount: 2,
    });
  });
});
