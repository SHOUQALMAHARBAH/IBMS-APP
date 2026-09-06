import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { PRIVACY_NOTICE_TOUCHPOINTS } from '../privacy-notice.config';

export class CreatePrivacyNoticeDto {
  @IsIn(PRIVACY_NOTICE_TOUCHPOINTS, {
    message: `touchpoint must be one of: ${PRIVACY_NOTICE_TOUCHPOINTS.join(', ')}`,
  })
  touchpoint!: (typeof PRIVACY_NOTICE_TOUCHPOINTS)[number];

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(20000)
  textAr!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(20000)
  textEn!: string;
}
