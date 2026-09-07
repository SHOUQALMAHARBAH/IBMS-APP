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

export class UpdateRopaEntryDto {
  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(300)
  processingActivity?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  categoriesOfData?: string[];

  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(2000)
  purpose?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  recipients?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  retentionPeriodMonths?: number;
}
