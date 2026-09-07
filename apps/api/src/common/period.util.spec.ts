import { describe, expect, it } from 'vitest';
import { previousUtcMonthRange } from './period.util';

describe('previousUtcMonthRange', () => {
  it('returns the prior calendar month for a mid-month date', () => {
    const range = previousUtcMonthRange(new Date('2026-09-17T14:32:00.000Z'));
    expect(range.periodLabel).toBe('2026-08');
    expect(range.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(range.periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls back across a year boundary for January', () => {
    const range = previousUtcMonthRange(new Date('2026-01-15T00:00:00.000Z'));
    expect(range.periodLabel).toBe('2025-12');
    expect(range.periodStart.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(range.periodEnd.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
