import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { QuotationTermsDto } from './quotation-terms.dto';

/** Process 13 — record a renegotiation round as a NEW `Quotation` version.
 * The `:id` in the path is the current version being superseded; `rfqId` /
 * `insurerId` are inherited from it, never re-supplied. The old row is kept
 * verbatim (`isCurrentVersion` flipped to false) — a version chain is never
 * overwritten (Part 4.1, Part 3.3 Controls).
 *
 * This body is the **complete** term set for the new version, not a patch:
 * an optional field left out becomes `null` on the successor row (the web
 * form pre-fills every field from the current version so a human never
 * silently drops a term; a direct API caller must send the full set). */
export class ReviseQuotationDto extends QuotationTermsDto {
  /** Backlog Part C #15 — the broker's documented rationale for this
   * negotiation round (what was requested / conceded). Optional, free text,
   * Confidential (never in the audit snapshot — only a presence boolean).
   * Not part of `QuotationTermsDto`: a version-1 `capture` is an insurer's
   * opening quote, not a negotiation round. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(4000)
  negotiationNotes?: string;
}
