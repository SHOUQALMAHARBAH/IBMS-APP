import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** Process 3 — corporate KYC UBO capture. `isPep` has no default, same
 * rationale as CreateLeadDto.marketingConsentGranted: a PEP flag is a
 * material compliance fact the officer must affirmatively state, never
 * silently default to "false" (Part 5.1/6.3 — the caller must say). */
export class CreateUboDto {
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsString()
  @Length(5, 40)
  nationalId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercent?: number;

  @IsOptional()
  @IsBoolean()
  isAuthorizedSignatory?: boolean;

  @IsBoolean()
  isPep!: boolean;
}
