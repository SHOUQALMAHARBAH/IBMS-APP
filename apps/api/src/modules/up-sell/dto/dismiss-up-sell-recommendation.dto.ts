import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** Process 9 — dismissing an up-sell recommendation requires a reason (why
 * the increase is not being pursued) so a later review can tell "client
 * declined" from "figures wrong" from "already endorsed elsewhere". Stored
 * on `UpSellRecommendation.dismissReason`. */
export class DismissUpSellRecommendationDto {
  @Transform(trimIfString)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
