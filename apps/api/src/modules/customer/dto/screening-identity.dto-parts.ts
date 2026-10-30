import { Matches } from 'class-validator';
import { IsCalendarDate } from '../../../common/is-calendar-date.validator';

/**
 * Part B §11 — the two identity discriminators, validated identically wherever
 * they appear (a Customer, a UBO).
 *
 * Both mirror a real database CHECK constraint, deliberately. The DTO gives a
 * usable error message; the constraint is what makes the rule true for every
 * write path including a migration, a seed, or a future admin tool. Neither is
 * redundant.
 *
 * `nationality` is ISO 3166-1 alpha-2 and nothing else. A free-text column
 * collects "Jordan", "JORDAN", "Jordanian", "JO" and "962" within a month, and
 * comparing across those is a comparison that silently never matches — which,
 * on a screening discriminator, means quietly degrading back to name-only
 * matching without anything reporting it.
 */
export const NATIONALITY_PATTERN = /^[A-Z]{2}$/;
export const NATIONALITY_MESSAGE =
  'nationality must be an ISO 3166-1 alpha-2 country code in upper case (e.g. JO)';

/** `YYYY-MM-DD`. Not a full timestamp: a date of birth has no time of day, and
 * accepting one invites a timezone to shift it across a day boundary. */
export const DATE_OF_BIRTH_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_OF_BIRTH_FIELD = 'dateOfBirth';
export const DATE_OF_BIRTH_MESSAGE =
  'dateOfBirth must be a date in YYYY-MM-DD form';

/**
 * The predicate on its own, so a test can exercise it without building a DTO.
 * Same regex the decorator uses, which is the point: one home.
 */
export function isNationalityCode(value: string): boolean {
  return NATIONALITY_PATTERN.test(value);
}

export function IsNationality() {
  return Matches(NATIONALITY_PATTERN, { message: NATIONALITY_MESSAGE });
}

/**
 * The SHAPE and then the DAY, as two decorators, because they are two different
 * refusals and IMPROVEMENTS § 1.64's rule says to pair them rather than replace
 * one with the other.
 *
 * `@Matches` alone admits three non-dates, and only one of them is loud:
 * `2026-04-00` and `2026-13-01` give an Invalid Date, while **`2026-02-30`
 * parses cleanly to 2 MARCH** — so a typo would be STORED as a date of birth
 * nobody typed. That matters more here than on the report windows § 1.64 left
 * open: this value is persisted AND it is a screening discriminator, so a
 * silently rolled-over day is a date of birth that will never match the right
 * list entry and will quietly match the wrong one.
 *
 * The database CHECK is no help: `Customer_dateOfBirth_not_future` only refuses
 * a future date, and 2 March is not in the future.
 */
export function IsDateOfBirth() {
  return function (object: object, propertyName: string): void {
    Matches(DATE_OF_BIRTH_PATTERN, { message: DATE_OF_BIRTH_MESSAGE })(
      object,
      propertyName,
    );
    IsCalendarDate({
      message: `${DATE_OF_BIRTH_FIELD} must be a day that exists`,
    })(object, propertyName);
  };
}
