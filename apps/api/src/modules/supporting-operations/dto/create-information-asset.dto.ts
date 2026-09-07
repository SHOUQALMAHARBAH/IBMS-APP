import { IsIn, IsString, IsUUID, Length } from 'class-validator';
import { DataClassification } from '@ibms/db';
import { ASSET_TYPES, type AssetType } from '../information-asset.config';

const CLASSIFICATIONS = Object.values(DataClassification);

/** Process 69 — `POST /information-assets` (`information-asset.manage`).
 * `ownerUserId` is a bare scalar (no Prisma relation, the
 * `Opportunity.createdByUserId` shape) — the service still verifies it
 * points at a real `User` before creating, so a typo'd id doesn't silently
 * orphan an asset record. */
export class CreateInformationAssetDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsIn(ASSET_TYPES)
  assetType!: AssetType;

  @IsUUID()
  ownerUserId!: string;

  @IsIn(CLASSIFICATIONS, {
    message: `classification must be one of: ${CLASSIFICATIONS.join(', ')}`,
  })
  classification!: DataClassification;
}
