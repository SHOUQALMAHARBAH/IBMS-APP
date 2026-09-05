import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { INTERNAL_AUDIT_FINDING_STATUSES } from '../internal-audit-finding.config';

/** Process 57 — `GET /internal-audit-findings?status=`. */
export class ListInternalAuditFindingQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(INTERNAL_AUDIT_FINDING_STATUSES)
  status?: string;
}
