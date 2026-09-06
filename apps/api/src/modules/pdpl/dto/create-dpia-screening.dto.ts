import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

export class CreateDpiaScreeningDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(2000)
  subjectDescription!: string;

  @IsBoolean()
  qSensitiveData!: boolean;

  @IsBoolean()
  qLargeScaleProcessing!: boolean;

  @IsBoolean()
  qCrossBorderTransfer!: boolean;

  @IsBoolean()
  qNewTechnologyMonitoring!: boolean;

  @IsBoolean()
  qNewDigitalChannel!: boolean;
}
