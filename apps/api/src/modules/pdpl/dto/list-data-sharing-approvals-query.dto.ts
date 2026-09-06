import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { DataClassification } from '@ibms/db';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';

const CLASSIFICATIONS = Object.values(DataClassification);

export class ListDataSharingApprovalsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(CLASSIFICATIONS)
  classification?: string;

  @IsOptional()
  @Transform(queryBoolean)
  pendingOnly?: boolean;
}
