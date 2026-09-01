import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `GET /quotations` is scoped to exactly one parent — an RFQ, an
 * Opportunity, or a Customer. The service rejects "neither" and "more than
 * one" (422); visibility is resolved against whichever parent is given (and
 * ultimately against that parent's Customer, like the RFQ module). */
export class ListQuotationsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  rfqId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
