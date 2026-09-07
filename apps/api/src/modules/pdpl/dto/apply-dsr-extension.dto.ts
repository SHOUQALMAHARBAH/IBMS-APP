import { IsString, Length, Matches } from 'class-validator';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../../common/dto.util';

/** M04 — `POST /dsr/:id/apply-extension` (`dsr.handle`). The one +15
 * business-day extension, ACCESS type only, write-once
 * (`canApplyDsrExtension` / `accessExtensionAppliedAt IS NULL`). */
export class ApplyDsrExtensionDto {
  @IsString()
  @Length(1, 1000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `reason ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  reason!: string;
}
