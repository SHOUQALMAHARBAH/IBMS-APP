import { describe, expect, it } from 'vitest';
import { resolvePeriodLabel } from './planning-export.config';

describe('resolvePeriodLabel', () => {
  it('uses the explicit override when given', () => {
    expect(
      resolvePeriodLabel('2026-01', new Date('2026-09-14T00:00:00Z')),
    ).toBe('2026-01');
  });

  it('defaults to the previous UTC calendar month when no override is given', () => {
    expect(
      resolvePeriodLabel(undefined, new Date('2026-09-14T00:00:00Z')),
    ).toBe('2026-08');
  });

  it('rolls back across a UTC year boundary', () => {
    expect(
      resolvePeriodLabel(undefined, new Date('2026-01-05T00:00:00Z')),
    ).toBe('2025-12');
  });
});
