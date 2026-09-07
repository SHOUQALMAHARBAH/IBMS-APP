import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { parseCalendarDate } from './calendar-date.util';

describe('parseCalendarDate', () => {
  it('accepts a bare date as UTC midnight', () => {
    expect(parseCalendarDate('2026-10-01', 'inceptionDate').toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('accepts a future date (a policy can incept next month)', () => {
    const d = parseCalendarDate('2099-01-01', 'inceptionDate');
    expect(d.getUTCFullYear()).toBe(2099);
  });

  it('accepts a datetime with an explicit offset', () => {
    expect(
      parseCalendarDate('2026-10-01T09:00:00+03:00', 'x').toISOString(),
    ).toBe('2026-10-01T06:00:00.000Z');
  });

  it('rejects a datetime with no offset (server-local shift trap)', () => {
    expect(() => parseCalendarDate('2026-10-01T09:00:00', 'x')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects an unparseable string', () => {
    expect(() => parseCalendarDate('not-a-date', 'x')).toThrow(
      UnprocessableEntityException,
    );
  });
});
