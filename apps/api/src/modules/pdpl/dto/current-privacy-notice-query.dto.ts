import { IsIn } from 'class-validator';
import { PRIVACY_NOTICE_TOUCHPOINTS } from '../privacy-notice.config';

export class CurrentPrivacyNoticeQueryDto {
  @IsIn(PRIVACY_NOTICE_TOUCHPOINTS, {
    message: `touchpoint must be one of: ${PRIVACY_NOTICE_TOUCHPOINTS.join(', ')}`,
  })
  touchpoint!: (typeof PRIVACY_NOTICE_TOUCHPOINTS)[number];
}
