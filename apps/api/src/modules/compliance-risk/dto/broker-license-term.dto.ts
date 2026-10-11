import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Module 0 item (c) — the fields every licence TERM carries, declared ONCE.
 *
 * `CreateBrokerLicenseDto` and `RenewBrokerLicenseDto` both extend this and add nothing: the two
 * routes differ in what they REQUIRE of the office's existing terms (none / at least one), not in
 * what a term looks like. Before this item they were two independent copies of the same four
 * fields, which is two places for the certificate requirement to be forgotten — the same reason
 * `CombinedDutyDeclarationDto` is one class rather than fifteen.
 *
 * THE CERTIFICATE IS MANDATORY HERE AND NOT NULL IN THE DATABASE, which are two different
 * guarantees and both are wanted. The column refuses a term with no certificate however it is
 * written — raw SQL, a migration, a future service. These decorators refuse an API caller who
 * omits it, with a message naming the field, instead of letting a NOT NULL violation surface as a
 * 500.
 */
export class BrokerLicenseTermDto {
  @IsString()
  @Length(1, 200)
  licenseNumber!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 500)
  scopeOfAuthorization?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  issuedAt?: string;

  @IsString()
  expiresAt!: string;

  /** The certificate's file name as filed. Required — a term is the broker's evidence that it may
   *  practise, and one recorded with no certificate behind it records a claim, not a fact. */
  @IsString()
  @Length(1, 400)
  certificateFileName!: string;

  /** Where the certificate is filed. Required for the same reason.
   *
   *  NOTE, so the requirement is not read as more than it is: this application has no object
   *  storage anywhere (pre-existing and documented), so this names a location nothing can currently
   *  fetch. What the requirement buys today is that the certificate is FILED AND ATTRIBUTED — a
   *  `Document` row with a name, a category, a classification and an uploader — not that the bytes
   *  are retrievable. */
  @IsString()
  @Length(1, 500)
  certificateStorageRef!: string;
}
