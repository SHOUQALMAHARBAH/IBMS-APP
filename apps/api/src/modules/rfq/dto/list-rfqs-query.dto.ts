import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /rfqs` is scoped to exactly one parent — an Opportunity or a
 * Customer. The service rejects "neither" and "both" (422); visibility is
 * resolved against whichever parent is given. */
export class ListRfqsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
