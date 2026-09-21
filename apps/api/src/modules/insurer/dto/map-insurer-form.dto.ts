import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { InsurerFormFieldType } from '@ibms/db';

export class MapInsurerFormFieldDto {
  /** The stable machine key a submission is written against. */
  @IsString()
  @Length(1, 100)
  fieldKey!: string;

  @IsString()
  @Length(1, 200)
  labelEn!: string;

  /** The platform's primary language is Arabic, so an Arabic label is what
   * most users will actually read. Optional only because the insurer's own
   * form may be English-only — an absent label is honest, an invented one is
   * not. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  labelAr?: string;

  @IsEnum(InsurerFormFieldType)
  dataType!: InsurerFormFieldType;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  options?: string[];

  @IsInt()
  @Min(0)
  displayOrder!: number;
}

/**
 * Part I §5 — the one-time mapping of an insurer's official form for one
 * product line. Submitting this again for the same insurer+line records a NEW
 * version; it never edits the mapping other offices are already submitting
 * against.
 */
export class MapInsurerFormDto {
  /** The GLOBAL `InsuranceLine.id` this form is for. A uuid, not a name — and the lookup, not
   *  the validator, decides whether it exists: an unknown id is a 422 naming it, and an
   *  OFFICE's own line id is a 422 explaining that a globally-readable mapping cannot point at
   *  one office's private vocabulary. `@IsUUID()` only rejects things that are not ids at all. */
  @IsUUID()
  insuranceLineId!: string;

  /** The uploaded PDF/Word this mapping was derived from, so the mapping can
   * always be checked back against its source. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  sourceDocumentRef?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => MapInsurerFormFieldDto)
  fields!: MapInsurerFormFieldDto[];
}
