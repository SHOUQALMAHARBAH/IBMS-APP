import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { KycStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Backs the Compliance queue (GET /kyc-records) — no owner-scoping filter
 * here the way Lead/Prospect/Customer have: kyc.approve is COMPLIANCE-only
 * in the seeded permission grid, and every Compliance Officer sees the
 * whole queue, not a per-officer slice (there is no "compliance officer who
 * owns this KYC file" concept — the maker is the Sales Officer who
 * captured it, not a Compliance owner). */
export class ListKycRecordsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(KycStatus))
  status?: KycStatus;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;
}
