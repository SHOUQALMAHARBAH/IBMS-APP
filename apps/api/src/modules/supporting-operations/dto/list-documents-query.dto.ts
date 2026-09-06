import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { DataClassification, DocumentCategory } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { DATA_CLASSIFICATIONS, DOCUMENT_CATEGORIES } from '../document.config';

/** `GET /documents?policyId=&customerId=&category=&classification=` — every
 * filter optional and combinable. */
export class ListDocumentsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(DOCUMENT_CATEGORIES)
  category?: DocumentCategory;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(DATA_CLASSIFICATIONS, {
    message: `classification must be one of: ${DATA_CLASSIFICATIONS.join(', ')}`,
  })
  classification?: DataClassification;
}
