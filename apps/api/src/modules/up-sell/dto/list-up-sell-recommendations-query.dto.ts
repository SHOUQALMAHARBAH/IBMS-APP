import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { UpSellStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /up-sell-recommendations` is always scoped to one customer — a
 * recommendation only means anything in a customer's context, and the
 * caller's visibility is resolved against that Customer (see
 * UpSellService.list). Same shape as ListCrossSellOpportunitiesQueryDto. */
export class ListUpSellRecommendationsQueryDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(UpSellStatus))
  status?: UpSellStatus;
}
