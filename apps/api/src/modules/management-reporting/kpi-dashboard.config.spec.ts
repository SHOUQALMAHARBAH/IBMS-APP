import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  buildStatusCountMap,
  formatMoneySum,
  startOfCurrentUtcMonth,
} from './kpi-dashboard.config';

describe('buildStatusCountMap', () => {
  it('maps groupBy rows to a plain status->count object', () => {
    expect(
      buildStatusCountMap([
        { status: 'open', count: 3 },
        { status: 'closed', count: 7 },
      ]),
    ).toEqual({ open: 3, closed: 7 });
  });

  it('returns an empty object for an empty result set', () => {
    expect(buildStatusCountMap([])).toEqual({});
  });
});

describe('startOfCurrentUtcMonth', () => {
  it('returns midnight UTC on the 1st of the month containing now', () => {
    const now = new Date('2026-09-17T14:32:00.000Z');
    expect(startOfCurrentUtcMonth(now).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('handles the first day of the month itself', () => {
    const now = new Date('2026-01-01T00:00:00.001Z');
    expect(startOfCurrentUtcMonth(now).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });
});

describe('formatMoneySum', () => {
  it('formats a Prisma.Decimal sum to fixed 3dp', () => {
    expect(formatMoneySum(new Prisma.Decimal('1234.5'))).toBe('1234.500');
  });

  it('renders a null aggregate (no matching rows) as zero, not a crash', () => {
    expect(formatMoneySum(null)).toBe('0.000');
  });
});
