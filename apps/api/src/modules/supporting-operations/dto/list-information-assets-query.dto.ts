import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { DataClassification } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { ASSET_TYPES, type AssetType } from '../information-asset.config';

const CLASSIFICATIONS = Object.values(DataClassification);

/** Process 69 — `GET /information-assets?assetType=&classification=`
 * (`information-asset.manage`). Both filters optional and combinable. */
export class ListInformationAssetsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(ASSET_TYPES)
  assetType?: AssetType;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(CLASSIFICATIONS, {
    message: `classification must be one of: ${CLASSIFICATIONS.join(', ')}`,
  })
  classification?: DataClassification;
}
