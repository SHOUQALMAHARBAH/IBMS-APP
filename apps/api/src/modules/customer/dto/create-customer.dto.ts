import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerType, LanguagePreference } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Enforces that the two customer forms stay mutually exclusive: an
 * INDIVIDUAL record never carries the corporate-only fields, and a
 * CORPORATE record never carries a personal `nationalId`. `@ValidateIf`
 * alone only makes the *required-for-this-type* fields optional for the
 * other type — it does not reject a value the other form should never send,
 * so without this a `{ customerType: 'CORPORATE', nationalId: '...' }` body
 * would sail through validation and `CustomerService.create()` would still
 * encrypt it into `nationalIdEnc`.
 */
@ValidatorConstraint({ name: 'customerTypeFieldCoherence' })
class CustomerTypeFieldCoherence implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateCustomerDto;
    if (dto.customerType === 'CORPORATE') {
      return dto.nationalId === undefined || dto.nationalId === null;
    }
    if (dto.customerType === 'INDIVIDUAL') {
      return (
        dto.registrationNumber == null &&
        dto.registeredAddress == null &&
        dto.natureOfBusiness == null
      );
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as CreateCustomerDto;
    return dto.customerType === 'CORPORATE'
      ? 'nationalId is only accepted on the INDIVIDUAL customer form'
      : 'registrationNumber, registeredAddress and natureOfBusiness are only accepted on the CORPORATE customer form';
  }
}

/** Process 3-4 — "Create a Customer via two distinct forms (short
 * individual / full corporate)". The two screens
 * (apps/web/components/customer/) render different field sets, but both
 * post here: `customerType` decides which of the corporate-only fields
 * (`registrationNumber`, `registeredAddress`, `natureOfBusiness`) are
 * required, via `@ValidateIf`; `CustomerTypeFieldCoherence` (on
 * `customerType`) rejects a body that mixes the two forms. */
export class CreateCustomerDto {
  @IsIn(Object.values(CustomerType))
  @Validate(CustomerTypeFieldCoherence)
  customerType!: CustomerType;

  /** Individual: full name. Corporate: registered legal name. */
  @IsString()
  @Length(1, 300)
  legalName!: string;

  @ValidateIf((o: CreateCustomerDto) => o.customerType === 'INDIVIDUAL')
  @IsString()
  @Length(5, 40)
  nationalId?: string;

  @ValidateIf((o: CreateCustomerDto) => o.customerType === 'CORPORATE')
  @IsString()
  @Length(1, 100)
  registrationNumber?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  taxRegistrationNumber?: string;

  @ValidateIf((o: CreateCustomerDto) => o.customerType === 'CORPORATE')
  @IsString()
  @Length(1, 300)
  registeredAddress?: string;

  @ValidateIf((o: CreateCustomerDto) => o.customerType === 'CORPORATE')
  @IsString()
  @Length(1, 200)
  natureOfBusiness?: string;

  @IsString()
  @Length(4, 40)
  contactPhone!: string;

  @IsEmail()
  contactEmail!: string;

  @IsIn(Object.values(LanguagePreference))
  languagePreference!: LanguagePreference;

  /** Optional link back to the qualifying Prospect (0..1, same shape as
   * Lead->Prospect) — a Customer may also be onboarded directly with no
   * prior Prospect. Does not advance Prospect.status: that field has no
   * workflow-engine transitions in this backlog item either (see the C#2
   * "Known gaps" note) — creating a Customer from a Prospect is not treated
   * as the trigger to add one now. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  prospectId?: string;
}
