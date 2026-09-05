import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Parses a client-supplied calendar date (a policy's inception/expiry, an
 * endorsement's effective date, a license's issue/expiry, a compliance
 * obligation's due date, ...) into a `Date`. Unlike `parseHistoricalInstant`,
 * such a date MAY be in the future (cover can incept next month, a license
 * can expire next year) — so there is no not-future check — but the same
 * server-local-time trap applies: a datetime with no offset
 * (`2026-10-01T00:00:00`) is parsed as server-local and silently shifts the
 * instant, so a time component MUST carry an explicit offset. A bare date
 * (`2026-10-01`, parsed as UTC midnight) is the expected form and is
 * unambiguous.
 *
 * Originally local to `policy.config.ts` (Process 18-19); promoted here once
 * `endorsement.service.ts` (Process 22) and `compliance-risk` (Process 51)
 * needed the identical parse — `policy.config.ts` re-exports it so existing
 * `from './policy.config'` imports keep working unchanged.
 */
export function parseCalendarDate(raw: string, label: string): Date {
  const hasTimeComponent = /\d{2}:\d{2}/.test(raw);
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (hasTimeComponent && !hasOffset) {
    throw new UnprocessableEntityException(
      `${label} must be a plain date (e.g. "2026-10-01") or carry an explicit timezone offset`,
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityException(`${label} is not a valid date`);
  }
  return parsed;
}
