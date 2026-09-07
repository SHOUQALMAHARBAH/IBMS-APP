import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

export class CreateRopaEntryDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(300)
  processingActivity!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  categoriesOfData!: string[];

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(2000)
  purpose!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  recipients!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  retentionPeriodMonths?: number;
}
