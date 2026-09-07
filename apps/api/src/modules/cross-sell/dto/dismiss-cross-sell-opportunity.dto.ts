import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** Process 8 — dismissing a cross-sell opportunity requires a reason (why
 * the gap is not being pursued) so a later review can tell "not relevant"
 * from "client said no" from "already covered elsewhere". Stored on
 * `CrossSellOpportunity.dismissReason`. */
export class DismissCrossSellOpportunityDto {
  @Transform(trimIfString)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
