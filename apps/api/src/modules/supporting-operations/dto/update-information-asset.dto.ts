import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { DataClassification } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { ASSET_TYPES, type AssetType } from '../information-asset.config';

const CLASSIFICATIONS = Object.values(DataClassification);

/** Process 69 — `PATCH /information-assets/:id` (`information-asset.manage`).
 * Ordinary register hygiene — rename, reclassify, reassign an owner, or
 * correct the asset type. */
export class UpdateInformationAssetDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(ASSET_TYPES)
  assetType?: AssetType;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(CLASSIFICATIONS, {
    message: `classification must be one of: ${CLASSIFICATIONS.join(', ')}`,
  })
  classification?: DataClassification;
}
