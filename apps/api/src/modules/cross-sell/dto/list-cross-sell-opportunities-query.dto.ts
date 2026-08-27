import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { CrossSellStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /cross-sell-opportunities` is always scoped to one customer — an
 * opportunity only means anything in a customer's context, and the caller's
 * visibility is resolved against that Customer (see CrossSellService.list).
 * Same shape as ListInsuranceProgramsQueryDto, plus an optional status
 * filter (mirrors ListLeadsQueryDto). */
export class ListCrossSellOpportunitiesQueryDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(CrossSellStatus))
  status?: CrossSellStatus;
}
