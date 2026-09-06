import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DataClassification, DataSharingChannel } from '@ibms/db';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

const CLASSIFICATIONS = Object.values(DataClassification);
const CHANNELS = Object.values(DataSharingChannel);

export class CreateDataSharingApprovalDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  vendorId?: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(20, {
    message:
      'description must describe what data is being shared and why (minimum-necessary-data check) — at least 20 characters',
  })
  @MaxLength(2000)
  description!: string;

  @IsIn(CLASSIFICATIONS, {
    message: `classification must be one of: ${CLASSIFICATIONS.join(', ')}`,
  })
  classification!: (typeof CLASSIFICATIONS)[number];

  @IsIn(CHANNELS, { message: `channel must be one of: ${CHANNELS.join(', ')}` })
  channel!: (typeof CHANNELS)[number];

  @IsOptional()
  @IsBoolean()
  isRegulatoryChannel?: boolean;
}
