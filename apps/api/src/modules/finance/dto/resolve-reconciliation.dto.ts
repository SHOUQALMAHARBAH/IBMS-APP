import { IsIn, IsOptional, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import { RECON_INVOICE_RESUME_STATUSES } from '../finance.config';

/**
 * Process 39 — `POST /reconciliation-exceptions/:id/resolve`
 * (`reconciliation-exception.resolve` / Finance, Manager). Closes an
 * exception with a mandatory written justification and, when its parent
 * `Invoice` is mid-exception (`EXCEPTION_RAISED` / `EXCEPTION_RESOLVED`),
 * resumes the collection cycle at `resumeInvoiceAs`. Resolving NEVER adjusts a
 * figure — the variance stays recorded.
 */
export class ResolveReconciliationDto {
  /** Why the variance is being closed — logged verbatim (the point of the
   * "investigation and closure path"). */
  @Transform(trimIfString)
  @MinLength(10)
  @MaxLength(2000)
  resolutionNote!: string;

  /** Where the parent `Invoice`'s collection cycle resumes once the exception
   * clears — required when the invoice is `EXCEPTION_RAISED` /
   * `EXCEPTION_RESOLVED`, ignored otherwise. Only `RECONCILED` is accepted:
   * resuming straight to `REMITTED` would skip the `Remittance` + client-funds
   * ledger entry that `POST /invoices/:id/remittance` books atomically, so
   * Finance completes the cycle with a normal remittance call afterwards. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...RECON_INVOICE_RESUME_STATUSES], {
    message: `resumeInvoiceAs must be one of: ${RECON_INVOICE_RESUME_STATUSES.join(', ')}`,
  })
  resumeInvoiceAs?: string;
}
