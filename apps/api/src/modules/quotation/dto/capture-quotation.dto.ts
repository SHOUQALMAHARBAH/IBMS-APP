import { IsUUID } from 'class-validator';
import { QuotationTermsDto } from './quotation-terms.dto';

/** Process 13 — capture an insurer's quote against one RFQ line as a
 * version-1 `Quotation`. `insurerId` must be on that RFQ's shortlist (a
 * quote can only come from a shortlisted insurer — 422 otherwise), and the
 * insurer must not already have a current quotation on the RFQ (409 — use
 * `POST /quotations/:id/revise` for a renegotiation). */
export class CaptureQuotationDto extends QuotationTermsDto {
  @IsUUID()
  rfqId!: string;

  @IsUUID()
  insurerId!: string;
}
