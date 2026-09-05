import { IsString, Length, Matches } from 'class-validator';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../../common/dto.util';

/** M04 — `POST /dsr/:id/reject` (`dsr.handle`). Legal from RECEIVED,
 * IDENTITY_VERIFIED, or IN_PROGRESS (`WORKFLOW_TRANSITIONS.
 * DataSubjectRequest`). A reason is mandatory — a rejected exercise of a
 * PDPL right with no recorded justification is a regulator-facing gap. */
export class RejectDsrDto {
  @IsString()
  @Length(1, 1000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `reason ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  reason!: string;
}
