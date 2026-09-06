import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { BCP_DR_SCENARIOS, type BcpDrScenario } from '../bcp-dr-plan.config';

/** Process 72-73 — `POST /bcp-dr-plans` (`bcp-dr.manage`). `planDocumentId`,
 * if given, is validated against a real `Document` in the service layer
 * (a bare scalar, no Prisma relation — the `Opportunity.createdByUserId`
 * shape). */
export class CreateBcpDrPlanDto {
  @IsIn(BCP_DR_SCENARIOS, {
    message: `scenario must be one of: ${BCP_DR_SCENARIOS.join(', ')}`,
  })
  scenario!: BcpDrScenario;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  planDocumentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  rtoHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rpoHours?: number;
}
