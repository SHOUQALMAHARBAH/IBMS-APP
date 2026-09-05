import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /client-decisions` is scoped to exactly one of `opportunityId` /
 * `customerId` (enforced in `ClientDecisionService.list`). */
export class ListClientDecisionsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
