import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 51 — `POST /broker-license` (`license.manage` / Compliance). One
 * per broker (409 if a record already exists — see `renew` to update it).
 * `issuedAt`/`expiresAt` are plain calendar dates (`parseCalendarDate`),
 * not restricted to the past or future.
 */
export class CreateBrokerLicenseDto {
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
}
