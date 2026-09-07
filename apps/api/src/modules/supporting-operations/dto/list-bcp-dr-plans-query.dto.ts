import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { BCP_DR_SCENARIOS, type BcpDrScenario } from '../bcp-dr-plan.config';

/** `GET /bcp-dr-plans?scenario=` — optional filter. */
export class ListBcpDrPlansQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(BCP_DR_SCENARIOS)
  scenario?: BcpDrScenario;
}
