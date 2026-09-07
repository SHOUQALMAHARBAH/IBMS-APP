import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** `insuranceLine`/`insurerId` are deliberately absent — none of the seven
 * underlying registers ties to a `Policy`; see `compliance-dashboard.
 * config.ts`'s header note. No `asOf` either — every section is pure
 * current-state. */
export class ComplianceDashboardQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;
}
