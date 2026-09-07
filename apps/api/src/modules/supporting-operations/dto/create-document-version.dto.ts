import { IsIn, IsString, Length } from 'class-validator';
import { DataClassification } from '@ibms/db';
import { DATA_CLASSIFICATIONS } from '../document.config';

/** A new version of an existing `Document` — `category`/`policyId`/
 * `customerId` are inherited from the version being superseded (a version
 * is a revision of the SAME logical document, not a new artifact); only the
 * content pointer and its classification can change. `classification` is
 * mandatory on every version, not just the first (Part 10.6 privacy-by-
 * default — the officer uploading must say which, the system never
 * defaults or carries the predecessor's forward silently). */
export class CreateDocumentVersionDto {
  @IsIn(DATA_CLASSIFICATIONS, {
    message: `classification must be one of: ${DATA_CLASSIFICATIONS.join(', ')}`,
  })
  classification!: DataClassification;

  @IsString()
  @Length(1, 300)
  fileName!: string;

  @IsString()
  @Length(1, 500)
  storageRef!: string;
}
