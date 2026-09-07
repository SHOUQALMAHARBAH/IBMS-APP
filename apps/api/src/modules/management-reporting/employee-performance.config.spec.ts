import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import type { EmployeePerformanceRecord } from '@ibms/db';
import {
  deriveEmployeePerformanceRecordView,
  formatMoneyOrNull,
  previousUtcMonthRange,
  ratePercentOrNull,
} from './employee-performance.config';

describe('ratePercentOrNull', () => {
  it('returns null when there is nothing to rate', () => {
    expect(ratePercentOrNull(0, 0)).toBeNull();
  });

  it('computes a percentage when there is a real denominator', () => {
    expect(ratePercentOrNull(1, 4)?.toString()).toBe('25');
  });

  it('is 0%, not null, when the denominator is real but nothing succeeded', () => {
    expect(ratePercentOrNull(0, 5)?.toString()).toBe('0');
  });

  it('rounds to 2dp', () => {
    expect(ratePercentOrNull(1, 3)?.toString()).toBe('33.33');
  });
});

describe('formatMoneyOrNull', () => {
  it('formats a real amount to fixed 3dp', () => {
    expect(formatMoneyOrNull(new Prisma.Decimal('1234.5'))).toBe('1234.500');
  });

  it('passes null through unchanged', () => {
    expect(formatMoneyOrNull(null)).toBeNull();
  });
});

describe('previousUtcMonthRange (re-exported)', () => {
  it('returns the prior calendar month', () => {
    const range = previousUtcMonthRange(new Date('2026-09-17T00:00:00.000Z'));
    expect(range.periodLabel).toBe('2026-08');
  });
});

describe('deriveEmployeePerformanceRecordView', () => {
  it('renders money as fixed 3dp strings, rates as fixed 2dp strings, and nulls through unchanged', () => {
    const row: EmployeePerformanceRecord = {
      id: 'record-1',
      employeeId: 'employee-1',
      periodLabel: '2026-08',
      newClients: 3,
      premiumWritten: new Prisma.Decimal('12500.5'),
      commissionEarned: new Prisma.Decimal('1875.075'),
      renewalRatePercent: new Prisma.Decimal('80'),
      crossSellRatePercent: null,
    };
    expect(deriveEmployeePerformanceRecordView(row)).toEqual({
      id: 'record-1',
      employeeId: 'employee-1',
      periodLabel: '2026-08',
      newClients: 3,
      premiumWrittenJod: '12500.500',
      commissionEarnedJod: '1875.075',
      renewalRatePercent: '80.00',
      crossSellRatePercent: null,
    });
  });

  it('renders a zero renewal rate ("0%", not null) distinctly from no renewal data at all', () => {
    const row: EmployeePerformanceRecord = {
      id: 'record-2',
      employeeId: 'employee-1',
      periodLabel: '2026-08',
      newClients: 0,
      premiumWritten: new Prisma.Decimal('0'),
      commissionEarned: new Prisma.Decimal('0'),
      renewalRatePercent: new Prisma.Decimal('0'),
      crossSellRatePercent: null,
    };
    const view = deriveEmployeePerformanceRecordView(row);
    expect(view.renewalRatePercent).toBe('0.00');
    expect(view.crossSellRatePercent).toBeNull();
  });
});
