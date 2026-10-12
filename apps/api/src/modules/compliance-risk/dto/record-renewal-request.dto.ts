import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Module 0 item (c) — `POST /broker-license/renewal-requested` (`license.manage` / Compliance).
 * Records that the renewal application for the term after the current one has been FILED.
 *
 * ## Why the date may be supplied, and why that is a tension rather than a convenience
 *
 * Art. 11 requires the application 45 days before expiry, and item (d) measures lateness against
 * this value — so it is load-bearing, not a note.
 *
 * Stamping `now()` server-side would be the tamper-proof choice and was rejected: an office that
 * files with the CBJ on paper on Sunday and records it in IBMS on Tuesday would be reported late
 * for a filing that was on time, which makes the control wrong in the direction that accuses the
 * brokerage — the same failure direction as the empty holiday calendar.
 *
 * So the date is OPTIONAL and defaults to today. The cost is that a late filing can be recorded as
 * timely by typing a date, which no validation can detect. What makes that visible rather than
 * silent is the audit row: it records the date recorded AND whether it was supplied or defaulted,
 * so "this was backdated" is a question the audit trail can answer.
 */
export class RecordRenewalRequestDto {
  /** A plain calendar date (`parseCalendarDate`). Omit for today. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  requestedAt?: string;
}
