import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { NeedsAssessmentStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Backs `GET /needs-assessments`. A Sales/Relationship Officer is scoped
 * server-side to assessments they captured regardless of any filter passed;
 * Placement/Manager/Executive see the whole book (see
 * NeedsAssessmentService.list). */
export class ListNeedsAssessmentsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  riskProfileId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(NeedsAssessmentStatus))
  status?: NeedsAssessmentStatus;
}
