import { IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { CROSS_BORDER_LEGAL_BASES } from '../cross-border-transfer.config';

export class ListCrossBorderTransfersQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(CROSS_BORDER_LEGAL_BASES)
  legalBasis?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  destinationCountry?: string;
}
