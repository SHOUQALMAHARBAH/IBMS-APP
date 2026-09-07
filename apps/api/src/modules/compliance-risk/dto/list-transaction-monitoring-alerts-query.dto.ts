import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';
import {
  TRANSACTION_MONITORING_PATTERN_TYPES,
  TRANSACTION_MONITORING_STATUSES,
} from '../transaction-monitoring.config';

/** Process 48 — `GET /transaction-monitoring-alerts`. All filters optional;
 * with none, the book-wide list (capped, newest first). */
export class ListTransactionMonitoringAlertsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...TRANSACTION_MONITORING_PATTERN_TYPES])
  patternType?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...TRANSACTION_MONITORING_STATUSES])
  status?: string;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  escalatedToSuspiciousActivity?: boolean;
}
