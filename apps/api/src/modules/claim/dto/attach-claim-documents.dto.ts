import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { DataClassification } from '@ibms/db';
import { CLAIM_DOC_TYPES } from '../claim.config';

const DOC_TYPES = [...CLAIM_DOC_TYPES];
const CLASSIFICATIONS = Object.values(DataClassification);

/** One documentation file to record on a claim's electronic file (Part 4.2) —
 * a pointer (`storageRef`, the encrypted object-storage key) + its
 * classification + the claim-specific `docType`, never the file bytes. A
 * `medical_report` MUST be `HIGHLY_CONFIDENTIAL` (enforced in the service —
 * `claims-lifecycle.md`, PDPL). */
export class ClaimDocumentInputDto {
  @IsIn(DOC_TYPES, {
    message: `docType must be one of: ${DOC_TYPES.join(', ')}`,
  })
  docType!: (typeof DOC_TYPES)[number];

  @IsIn(CLASSIFICATIONS, {
    message: `classification must be one of: ${CLASSIFICATIONS.join(', ')}`,
  })
  classification!: (typeof CLASSIFICATIONS)[number];

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(300)
  fileName!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(500)
  storageRef!: string;
}

/** Process 25 — attach one or more documentation files to a claim. Valid from
 * `REGISTERED` onward (the claim must be registered with the insurer first).
 * The first attach best-effort advances `REGISTERED → DOCUMENTATION_IN_PROGRESS`. */
export class AttachClaimDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClaimDocumentInputDto)
  documents!: ClaimDocumentInputDto[];
}
