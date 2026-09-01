import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { DATA_CLASSIFICATIONS, DOCUMENT_CATEGORIES } from '../policy.config';

/** One insurer-issued document to record on a policy's electronic Insurance
 * File (Part 4.2) — the policy wording, schedule PDF, endorsement template,
 * a certificate of insurance, the premium invoice, ... The broker records a
 * pointer (`storageRef`, the encrypted object-storage key) plus its
 * classification, never the file bytes. */
export class PolicyDocumentInputDto {
  @IsIn(DOCUMENT_CATEGORIES, {
    message: `category must be one of: ${DOCUMENT_CATEGORIES.join(', ')}`,
  })
  category!: (typeof DOCUMENT_CATEGORIES)[number];

  @IsIn(DATA_CLASSIFICATIONS, {
    message: `classification must be one of: ${DATA_CLASSIFICATIONS.join(', ')}`,
  })
  classification!: (typeof DATA_CLASSIFICATIONS)[number];

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(300)
  fileName!: string;

  /** The encrypted-at-rest object-storage key (Part 10.2), not a URL and not
   * the content. */
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(500)
  storageRef!: string;
}
