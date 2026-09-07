import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import { CROSS_BORDER_LEGAL_BASES } from '../cross-border-transfer.config';

export class CreateCrossBorderTransferDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(200)
  destinationCountry!: string;

  @IsIn(CROSS_BORDER_LEGAL_BASES, {
    message: `legalBasis must be one of: ${CROSS_BORDER_LEGAL_BASES.join(', ')}`,
  })
  legalBasis!: (typeof CROSS_BORDER_LEGAL_BASES)[number];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(500)
  legalBasisEvidenceRef?: string;
}
