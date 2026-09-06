import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { VENDOR_TYPES, type VendorType } from '../vendor.config';

/** Process 67 — `PATCH /vendors/:id` (`vendor.manage`). Ordinary register
 * hygiene (fix a typo'd name, reclassify a vendorType) — never touches
 * `riskTier`/DPA/annual-review, all #71's own concern. */
export class UpdateVendorDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(VENDOR_TYPES)
  vendorType?: VendorType;
}
