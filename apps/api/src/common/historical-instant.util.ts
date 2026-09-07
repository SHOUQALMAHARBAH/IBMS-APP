import { UnprocessableEntityException } from '@nestjs/common';

/** ~1 minute of clock-skew tolerance on a backdated instant before it counts
 * as a (nonsensical) future instant. */
export const HISTORICAL_INSTANT_FUTURE_SKEW_MS = 60_000;

/**
 * Parses a client-supplied "when did this happen" string into a `Date`,
 * rejecting the two ways it can be wrong.
 *
 * A DTO's `@IsISO8601()` lets both a bare date (`2026-02-01`) and an
 * offset-less datetime (`2026-02-01T09:00:00`) through — but
 * `new Date("2026-02-01T09:00:00")` is parsed as *server-local* time by the
 * JS engine, silently shifting the recorded instant for any caller that
 * isn't the web client (which always sends `...Z`). So a datetime MUST carry
 * an explicit offset; a bare date is fine (parsed as UTC midnight,
 * unambiguous). A future instant is rejected — the field is a record of
 * something that already happened.
 *
 * Shared by CRM interaction logging (backlog Part C #10) and RFQ
 * correspondence logging (backlog Part C #12). `label` names the offending
 * field in the 422 message.
 */
export function parseHistoricalInstant(
  raw: string,
  label = 'occurredAt',
): Date {
  const hasTimeComponent = /\d{2}:\d{2}/.test(raw);
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (hasTimeComponent && !hasOffset) {
    throw new UnprocessableEntityException(
      `${label} must carry an explicit timezone offset (e.g. "2026-02-01T09:00:00Z" or "2026-02-01T09:00:00+03:00"), or be a plain date`,
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityException(`${label} is not a valid date`);
  }
  if (parsed.getTime() > Date.now() + HISTORICAL_INSTANT_FUTURE_SKEW_MS) {
    throw new UnprocessableEntityException(
      `${label} cannot be in the future — it is a record of something that already happened`,
    );
  }
  return parsed;
}
