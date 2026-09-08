import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { VENDOR_TYPES, type VendorType } from '../vendor.config';

/** Process 67 — `GET /vendors?vendorType=` (`vendor.manage`). Optional
 * filter — #67's own procurement screen passes `vendorType=other`; #71's
 * future vendor-management screens will pass the other six. */
export class ListVendorsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(VENDOR_TYPES)
  vendorType?: VendorType;

  /** Part F item #6 — bilingual full-text search over name. See
   * ListCustomersQueryDto.search's own comment on why
   * `emptyStringToUndefined` is load-bearing here, not cosmetic. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;
}
