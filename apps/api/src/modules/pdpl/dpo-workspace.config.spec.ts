import { describe, expect, it } from 'vitest';
import { computeDaysUntilDue } from './dpo-workspace.config';

describe('computeDaysUntilDue', () => {
  it('is positive for a future due date', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(computeDaysUntilDue('2026-09-10T00:00:00.000Z', now)).toBe(3);
  });

  it('is negative for an already-overdue due date', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(computeDaysUntilDue('2026-09-04T00:00:00.000Z', now)).toBe(-3);
  });
});
