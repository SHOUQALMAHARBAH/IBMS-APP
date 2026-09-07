import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  RISK_REGISTER_STATUSES,
  RISK_REGISTER_TYPES,
} from '../risk-register.config';

/** Process 53 — `GET /risk-register?riskType=&status=`. */
export class ListRiskRegisterQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(RISK_REGISTER_TYPES)
  riskType?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(RISK_REGISTER_STATUSES)
  status?: string;
}
