import { IsOptional, Matches } from 'class-validator';
import { IsCalendarDate } from '../../../common/is-calendar-date.validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 40 — `GET /financial-report/summary`. `asOf` is the point-in-time
 * reference date for the receivables + payables sections — a plain
 * `YYYY-MM-DD`, today or earlier (a future `asOf` is meaningless; the service
 * 422s it), default today. Commission + profitability are current-state (the
 * commission ledger and `Policy.issuedPremium` are not time-versioned). No
 * line / insurer / branch filters here — those are a Part E dashboard
 * refinement.
 */
export class FinancialReportQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be a calendar date in YYYY-MM-DD form',
  })
  /*
   * § 1.64, closed 2026-09-29. PAIRED with the `@Matches` above rather than replacing it, so "that is not
   * a date" and "that day does not exist" stay two different messages — which is what helps whoever hits
   * one of them.
   *
   * `2026-02-30` passes the shape check and `new Date()` rolls it to 2 MARCH. Measured: the other two
   * shape-valid non-dates (`2026-04-00`, `2026-13-01`) are ALREADY refused, because
   * `parseHistoricalInstant` catches an Invalid Date — so the rollover was the only one getting through,
   * and it is the one a NaN check structurally cannot catch.
   *
   * Why this is not cosmetic on a read-only report: FOUR of the six `asOf` endpoints write the normalised
   * value into an `AuditLogEntry` (the claims dashboard puts it in `entityId`, which is indexed), and that
   * table is append-only — so a rolled-over date could not be corrected afterwards, only explained. That
   * corrects § 1.64's own stated reason, which said the consequence was a shifted window and not a stored
   * fact. Measured before the fix: 64 audit rows across dev and db-test, ZERO on any of the seven dates a
   * rollover can possibly produce, so nothing stored is wrong and no migration is owed.
   *
   * Applied as six DELIBERATE decorators rather than inside `parseHistoricalInstant`, on the owner's
   * ruling: that function has 30 call sites across 18 services, several of them financial, and the
   * status-code tidiness does not buy that blast radius.
   */
  @IsCalendarDate()
  asOf?: string;
}
