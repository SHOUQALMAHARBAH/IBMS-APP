import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /policies` is scoped to exactly one of `opportunityId` / `customerId`
 * (enforced in `PolicyService.list`). */
export class ListPoliciesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
