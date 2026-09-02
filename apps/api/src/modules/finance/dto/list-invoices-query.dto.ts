import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 31 — scope a `GET /invoices` read. At least one of `policyId` /
 * `customerId` is required (the service 400s otherwise) — a book-wide invoice
 * dump is Process 33's ageing report, not this endpoint.
 */
export class ListInvoicesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
