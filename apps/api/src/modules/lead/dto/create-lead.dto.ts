import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  LEAD_SOURCES,
  type LeadSource,
} from '../lead.constants';

export class CreateLeadDto {
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsIn(LEAD_SOURCES)
  source!: LeadSource;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 40)
  contactPhone?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsEmail()
  contactEmail?: string;

  /** Marketing consent, captured distinctly from KYC consent (Part 6.3) —
   * no default here on purpose: the intake screen must ask, not assume. */
  @IsBoolean()
  marketingConsentGranted!: boolean;
}
