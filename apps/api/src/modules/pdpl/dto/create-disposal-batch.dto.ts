import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** M06 — `POST /disposal-batches` (`retention.dispose.nominate`, the maker
 * side). `retentionScheduleItemId` is optional at the schema level but
 * required in practice to make the Legal-Hold-exclusion check meaningful —
 * a batch with none skips that check entirely (nothing to exclude
 * against). `nominatedByUserId` is never caller-suppliable — always the
 * actor. */
export class CreateDisposalBatchDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  retentionScheduleItemId?: string;
}
