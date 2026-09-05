import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../../common/dto.util';
import { TRANSACTION_MONITORING_PATTERN_TYPES } from '../transaction-monitoring.config';

/**
 * Process 48 — `POST /transaction-monitoring-alerts` (`aml.monitor` /
 * Compliance). The manual escape hatch alongside the automated `detect`
 * sweep — for a pattern Compliance notices that the four machine-detectable
 * checks don't cover (`patternType: 'other'`), or to log one of the four
 * named patterns by hand.
 */
export class CreateTransactionMonitoringAlertDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsIn([...TRANSACTION_MONITORING_PATTERN_TYPES], {
    message: `patternType must be one of: ${TRANSACTION_MONITORING_PATTERN_TYPES.join(', ')}`,
  })
  patternType!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 1000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `detailText ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  detailText?: string;
}
