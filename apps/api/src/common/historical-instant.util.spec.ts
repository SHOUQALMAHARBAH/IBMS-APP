import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { parseHistoricalInstant } from './historical-instant.util';

describe('parseHistoricalInstant', () => {
  it('accepts a bare date and parses it as UTC midnight', () => {
    expect(parseHistoricalInstant('2026-01-15')).toEqual(
      new Date('2026-01-15T00:00:00.000Z'),
    );
  });

  it('accepts a datetime with a Z offset', () => {
    expect(parseHistoricalInstant('2026-01-15T09:30:00.000Z')).toEqual(
      new Date('2026-01-15T09:30:00.000Z'),
    );
  });

  it('accepts a datetime with a numeric offset', () => {
    expect(parseHistoricalInstant('2026-01-15T09:30:00+03:00')).toEqual(
      new Date('2026-01-15T06:30:00.000Z'),
    );
  });

  it('rejects an offset-less datetime (would be parsed as server-local)', () => {
    expect(() => parseHistoricalInstant('2026-01-15T09:30:00')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects a future instant beyond the skew tolerance', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(() => parseHistoricalInstant(future)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('tolerates a near-now instant inside the ~1 min skew window', () => {
    const almostNow = new Date(Date.now() + 30_000).toISOString();
    expect(parseHistoricalInstant(almostNow)).toEqual(new Date(almostNow));
  });

  it('rejects an unparseable string', () => {
    expect(() => parseHistoricalInstant('not-a-date')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('names the offending field in the message via `label`', () => {
    expect(() =>
      parseHistoricalInstant('2026-01-15T09:30:00', 'sentAt'),
    ).toThrow(/sentAt must carry an explicit timezone offset/);
  });
});
