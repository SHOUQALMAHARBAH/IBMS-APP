import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { RECON_EXCEPTION_STATUSES } from '../finance.config';

/** Process 39 — `GET /reconciliation-exceptions`. Both filters optional; with
 * neither, the book-wide list (capped, newest first). */
export class ListReconciliationExceptionsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...RECON_EXCEPTION_STATUSES])
  status?: string;
}
