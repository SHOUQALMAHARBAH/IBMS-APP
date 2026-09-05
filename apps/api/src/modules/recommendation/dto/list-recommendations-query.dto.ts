import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /recommendations` is scoped to exactly one of `opportunityId` /
 * `customerId` (enforced in `RecommendationService.list`). Same shape as the
 * quotation list query. */
export class ListRecommendationsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
