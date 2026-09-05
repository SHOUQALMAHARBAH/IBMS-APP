import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import type { InsurerPerformanceScore } from '@ibms/db';
import {
  clampScore,
  daysBetween,
  deriveInsurerPerformanceScoreView,
  NEUTRAL_SCORE,
  previousUtcMonthRange,
  priceCompetitivenessScore,
  scoreFromAverageDays,
  scoreFromProportion,
} from './insurer-performance.config';

describe('clampScore', () => {
  it('passes a mid-range value through, rounded to 2dp', () => {
    expect(clampScore(new Prisma.Decimal('72.345')).toString()).toBe('72.35');
  });

  it('clamps above 100 down to 100', () => {
    expect(clampScore(new Prisma.Decimal('142.5')).toString()).toBe('100');
  });

  it('clamps below 0 up to 0', () => {
    expect(clampScore(new Prisma.Decimal('-5')).toString()).toBe('0');
  });
});

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

describe('scoreFromAverageDays', () => {
  it('scores 100 when the average meets the target exactly', () => {
    expect(scoreFromAverageDays(9, 9).toString()).toBe('100');
  });

  it('scores below 100 when the average is slower than target', () => {
    expect(scoreFromAverageDays(18, 9).toString()).toBe('50');
  });

  it('caps at 100 when the average beats the target', () => {
    expect(scoreFromAverageDays(3, 9).toString()).toBe('100');
  });
});

describe('scoreFromProportion', () => {
  it('converts a 0-1 proportion to a 0-100 score', () => {
    expect(scoreFromProportion(0.8).toString()).toBe('80');
  });

  it('handles a zero proportion', () => {
    expect(scoreFromProportion(0).toString()).toBe('0');
  });
});

describe('priceCompetitivenessScore', () => {
  it('scores 100 when this insurer is exactly at the field average', () => {
    expect(
      priceCompetitivenessScore('1000.000', [
        '1000.000',
        '1000.000',
      ]).toString(),
    ).toBe('100');
  });

  it('scores below 100 when this insurer is pricier than the field average', () => {
    expect(priceCompetitivenessScore('2000.000', ['1000.000']).toString()).toBe(
      '50',
    );
  });

  it('caps at 100 when this insurer is cheaper than the field average', () => {
    expect(priceCompetitivenessScore('500.000', ['1000.000']).toString()).toBe(
      '100',
    );
  });
});

describe('daysBetween', () => {
  it('computes whole and fractional days between two instants', () => {
    expect(
      daysBetween(
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-04T12:00:00.000Z'),
      ),
    ).toBe(3.5);
  });
});

describe('NEUTRAL_SCORE', () => {
  it('is the documented midpoint fallback', () => {
    expect(NEUTRAL_SCORE.toString()).toBe('50');
  });
});

describe('deriveInsurerPerformanceScoreView', () => {
  it('renders every score as a fixed 2dp string and the date as ISO', () => {
    const row: InsurerPerformanceScore = {
      id: 'score-1',
      insurerId: 'insurer-1',
      periodLabel: '2026-08',
      quoteResponseScore: new Prisma.Decimal('85.5'),
      claimsServiceScore: new Prisma.Decimal('100'),
      priceScore: new Prisma.Decimal('62.25'),
      serviceQualityScore: new Prisma.Decimal('50'),
      computedAt: new Date('2026-09-01T06:00:00.000Z'),
    };
    expect(deriveInsurerPerformanceScoreView(row)).toEqual({
      id: 'score-1',
      insurerId: 'insurer-1',
      periodLabel: '2026-08',
      quoteResponseScore: '85.50',
      claimsServiceScore: '100.00',
      priceScore: '62.25',
      serviceQualityScore: '50.00',
      computedAt: '2026-09-01T06:00:00.000Z',
    });
  });
});
