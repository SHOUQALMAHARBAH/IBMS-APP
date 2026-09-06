import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { PRIVACY_NOTICE_TOUCHPOINTS } from '../privacy-notice.config';

export class ListPrivacyNoticesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(PRIVACY_NOTICE_TOUCHPOINTS)
  touchpoint?: string;
}
