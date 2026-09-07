import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 57 — `POST /internal-audit-findings/:id/remediation`
 * (`internal-audit.record` / Compliance). Legal only while the finding is
 * still `open` — see `internal-audit-finding.repository.ts`'s
 * `recordRemediation`.
 */
export class UpdateInternalAuditFindingRemediationDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `remediationAction ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  remediationAction!: string;
}
