import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

const OUTCOMES = [
  'AUTO_APPROVED',
  'DPO_REVIEW_REQUIRED',
  'ESCALATED_FULL_DPIA',
] as const;

export class ListDpiaScreeningsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(OUTCOMES)
  outcome?: string;
}
