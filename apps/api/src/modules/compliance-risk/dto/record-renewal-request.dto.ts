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

  /**
   * 🔴 OWNER DECISION 128 — THE FILING PROOF, and the reason it is optional HERE rather than
   * required.
   *
   * «الإثبات يفتح، لا التاريخ». A date with no proof opens nothing at all now, so recording one is
   * harmless — and it has to stay possible, because it is the state criterion 1 tests and the
   * state every term recorded before today is in. Making these required would refuse a filing an
   * office legitimately wants to note before it has scanned the stamped copy.
   *
   * ⛔ BUT THEY TRAVEL TOGETHER. A document with no reference number, or a reference with no
   * document, is refused by the SERVICE and by a CHECK constraint — decision 128 §3 asks for the
   * file, the date and the Central Bank's number as one act, and half of it proves nothing.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  proofDocumentId?: string;

  /** The CBJ's inbound number, or the reference on its electronic acknowledgement. Decision 133
   *  ratified the label: «رقم الوارد أو الرقم المرجعي». */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  referenceNumber?: string;
}
