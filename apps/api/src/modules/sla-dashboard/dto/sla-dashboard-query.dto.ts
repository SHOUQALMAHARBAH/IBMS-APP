import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  SLA_TIMER_STATE_FILTERS,
  type SlaTimerStateFilter,
} from '../sla-dashboard.config';

/**
 * Process 43 — `GET /sla-dashboard/timers`. All three filters are optional;
 * with none, the endpoint returns every unresolved timer worst-first (the
 * `open` group default is applied in the service, not here). `workflowName` is
 * matched as a prefix so a base name catches its `::stage` rows.
 */
export class SlaDashboardTimersQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...SLA_TIMER_STATE_FILTERS])
  state?: SlaTimerStateFilter;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  workflowName?: string;
}
