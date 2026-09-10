import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { IsDateOfBirth, IsNationality } from './screening-identity.dto-parts';

/** Process 3 — corporate KYC UBO capture. `isPep` has no default, same
 * rationale as CreateLeadDto.marketingConsentGranted: a PEP flag is a
 * material compliance fact the officer must affirmatively state, never
 * silently default to "false" (Part 5.1/6.3 — the caller must say).
 *
 * A UBO is always a real individual, so — unlike Customer, which branches on
 * customerType — the Part F item #4 Jordanian national-ID-convention name
 * parts (given/father's/grandfather's/family name) always apply here; the
 * flat `fullName` is computed server-side from them (see
 * `composeFullName()`), not accepted directly. */
export class CreateUboDto {
  @IsString()
  @Length(1, 150)
  givenName!: string;

  /** Part B §11 — screening discriminators. Optional for the same reason as
   * on `CreateCustomerDto`: absent means "not known", which is different from
   * "does not match" and is reported as such. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateOfBirth()
  dateOfBirth?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsNationality()
  nationality?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  fatherName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  grandfatherName?: string;

  @IsString()
  @Length(1, 150)
  familyName!: string;

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
