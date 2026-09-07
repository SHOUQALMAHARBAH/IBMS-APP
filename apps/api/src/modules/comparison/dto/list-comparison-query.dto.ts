import { IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /comparison-matrices` is scoped to exactly one RFQ (a matrix is
 * 1:1 with its RFQ). */
export class ListComparisonQueryDto {
  @Transform(emptyStringToUndefined)
  @IsUUID()
  rfqId!: string;
}
