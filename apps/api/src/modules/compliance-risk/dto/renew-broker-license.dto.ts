import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 51 — `POST /broker-license/renew` (`license.manage` / Compliance).
 * Updates the existing singleton record's particulars and resets `status`
 * to `'active'` — a fresh license period supersedes any prior manual lapse.
 * 404 if no record exists yet (`create` first).
 */
export class RenewBrokerLicenseDto {
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
