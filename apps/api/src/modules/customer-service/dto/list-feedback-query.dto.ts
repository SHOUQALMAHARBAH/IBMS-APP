import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { FEEDBACK_CONTEXTS } from '../feedback.config';

/** Process 45 — `GET /feedback`. All filters optional; with none, the
 * book-wide list (capped, newest first). */
export class ListFeedbackQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...FEEDBACK_CONTEXTS])
  context?: string;
}
