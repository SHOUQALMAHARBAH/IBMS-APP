import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { LeadStatus } from '@ibms/db';
import {
  emptyStringToUndefined,
  LEAD_SOURCES,
  type LeadSource,
} from '../lead.constants';

export class ListLeadsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(LeadStatus))
  status?: LeadStatus;
}
