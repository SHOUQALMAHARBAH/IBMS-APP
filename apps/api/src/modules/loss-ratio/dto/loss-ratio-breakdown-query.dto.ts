import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { LOSS_RATIO_GROUP_BY } from '../loss-ratio.config';

/**
 * Process 30 — `GET /claims-analytics/loss-ratio`. `groupBy` is required; the
 * optional scope filters narrow the policy set before aggregation.
 */
export class LossRatioBreakdownQueryDto {
  @IsIn([...LOSS_RATIO_GROUP_BY])
  groupBy!: (typeof LOSS_RATIO_GROUP_BY)[number];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  insuranceLine?: string;
}
