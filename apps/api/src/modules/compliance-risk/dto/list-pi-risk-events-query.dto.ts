import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 54 — `GET /pi-risk-events?piPolicyId=&sourcePolicyCheckingId=`. */
export class ListPiRiskEventsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  piPolicyId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  sourcePolicyCheckingId?: string;
}
