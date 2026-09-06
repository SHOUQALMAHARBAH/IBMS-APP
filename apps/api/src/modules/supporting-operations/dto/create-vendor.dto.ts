import { IsIn, IsString, Length } from 'class-validator';
import { VENDOR_TYPES, type VendorType } from '../vendor.config';

/** Process 67 — `POST /vendors` (`vendor.manage`). Procurement's own use
 * case is `vendorType: 'other'`; the other six values exist for #71 (Vendor
 * Management) and Part D's third-party-governance register, the SAME
 * shared `Vendor` model. */
export class CreateVendorDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsIn(VENDOR_TYPES)
  vendorType!: VendorType;
}
