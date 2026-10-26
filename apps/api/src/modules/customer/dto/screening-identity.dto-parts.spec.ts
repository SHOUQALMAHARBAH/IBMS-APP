import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  IsDateOfBirth,
  IsNationality,
  isNationalityCode,
} from './screening-identity.dto-parts';

/*
 * THE TWO SCREENING DISCRIMINATORS' VALIDATION.
 *
 * The owner's walk raised these fields: «مش المفروض نضيف شو الجنسية و البلد و
 * تاريخ الميلاد عشان عملية اعرف عميلك ولا ايش؟ يعني كيف رح تشتغل عملية اعرف
 * عميلك ع الاسم بس؟» — and measuring the answer found the columns, the DTO, the
 * service and `buildScreeningSubjects` all already carried them, with only the
 * registration FORM missing. Fixing that made these validators load-bearing for
 * the first time, so they are tested for the first time.
 *
 * The date-of-birth case is the one worth having. `@Matches(/^\d{4}-\d{2}-\d{2}$/)`
 * admits three non-dates and only two of them are loud: `2026-04-00` and
 * `2026-13-01` give an Invalid Date, while `2026-02-30` PARSES CLEANLY TO
 * 2 MARCH. On a persisted screening discriminator that is the dangerous one —
 * a date of birth nobody typed, which will never match the right list entry and
 * may match the wrong one — and the database CHECK cannot catch it, because
 * `Customer_dateOfBirth_not_future` only refuses a future date and 2 March is
 * not in the future.
 */

class DobHolder {
  @IsDateOfBirth()
  dateOfBirth!: string;
}

class NationalityHolder {
  @IsNationality()
  nationality!: string;
}

async function messagesFor(holder: object): Promise<string[]> {
  const errors = await validate(holder);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('IsDateOfBirth', () => {
  it('accepts a real day', async () => {
    const h = new DobHolder();
    h.dateOfBirth = '1988-02-29';
    expect(await messagesFor(h)).toEqual([]);
  });

  it('REFUSES 30 February, which the shape check alone stores as 2 March', async () => {
    const h = new DobHolder();
    h.dateOfBirth = '2026-02-30';
    const messages = await messagesFor(h);
    // The SHAPE is fine, so the shape message must be absent and the DAY message
    // present — asserted apart, because a single "it was refused" would pass if
    // the two checks were ever collapsed into one and the wrong one fired.
    expect(messages).toContain('dateOfBirth must be a day that exists');
    expect(messages).not.toContain('dateOfBirth must be a date in YYYY-MM-DD form');
  });

  it.each(['2026-04-00', '2026-13-01', '2026-00-10'])(
    'refuses %s',
    async (value) => {
      const h = new DobHolder();
      h.dateOfBirth = value;
      expect(await messagesFor(h)).toContain(
        'dateOfBirth must be a day that exists',
      );
    },
  );

  it('refuses a full timestamp on the SHAPE, not the day', async () => {
    const h = new DobHolder();
    // A date of birth has no time of day, and accepting one invites a timezone
    // to shift it across a day boundary — the reason the pattern is date-only.
    h.dateOfBirth = '1988-02-29T00:00:00.000Z';
    const messages = await messagesFor(h);
    expect(messages).toContain('dateOfBirth must be a date in YYYY-MM-DD form');
  });
});

describe('IsNationality', () => {
  it('accepts an upper-case alpha-2 code', async () => {
    const h = new NationalityHolder();
    h.nationality = 'JO';
    expect(await messagesFor(h)).toEqual([]);
  });

  it.each(['jo', 'Jo', 'JOR', 'J', 'Jordan', '962', 'JO '])(
    'refuses %p, and says what the form is',
    async (value) => {
      const h = new NationalityHolder();
      h.nationality = value;
      expect(await messagesFor(h)).toEqual([
        'nationality must be an ISO 3166-1 alpha-2 country code in upper case (e.g. JO)',
      ]);
    },
  );

  it('mirrors the database CHECK exactly, so neither can admit what the other refuses', () => {
    // `Customer_nationality_iso3166` is CHECK (nationality ~ '^[A-Z]{2}$').
    // The predicate is restated here as a STRING rather than reusing the
    // exported regex, because comparing a value against itself proves nothing —
    // this fails if the exported pattern is ever widened away from the column.
    expect(isNationalityCode('JO')).toBe(true);
    expect(isNationalityCode('jo')).toBe(false);
    expect(isNationalityCode('JOR')).toBe(false);
  });
});
