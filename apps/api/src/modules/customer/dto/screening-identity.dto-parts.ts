import { Matches } from 'class-validator';

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
export const DATE_OF_BIRTH_MESSAGE =
  'dateOfBirth must be a date in YYYY-MM-DD form';

export function IsNationality() {
  return Matches(NATIONALITY_PATTERN, { message: NATIONALITY_MESSAGE });
}

export function IsDateOfBirth() {
  return Matches(DATE_OF_BIRTH_PATTERN, { message: DATE_OF_BIRTH_MESSAGE });
}
