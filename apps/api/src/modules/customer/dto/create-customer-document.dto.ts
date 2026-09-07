import { IsIn, IsString, Length } from 'class-validator';
import { DataClassification } from '@ibms/db';

/** Process 3-4 — "Capture KYC + upload supporting documents (Document,
 * category APPLICATION_PROPOSAL)". `category` is fixed to
 * APPLICATION_PROPOSAL by CustomerService, not accepted here — every
 * customer-scoped onboarding document is that one category by the backlog's
 * own wording, so there is nothing for a caller to choose (and no way to
 * mis-attach a Policy-lifecycle category to a pre-Policy Customer document).
 *
 * `storageRef` is a caller-supplied filename/reference, not an uploaded
 * file: no object-storage/upload pipeline exists behind `Document.storageRef`
 * anywhere in this repo yet (see document-export.util.ts's header comment
 * and README § Known gaps, A.3) — this module does not add one either.
 *
 * `classification` is required, never defaulted — Part 10.6 privacy-by-
 * default: a scanned national ID image is HIGHLY_CONFIDENTIAL
 * (sensitive-data-handling.md), a general proposal form may only be
 * CONFIDENTIAL, and the officer uploading must say which, not have the
 * system assume. PUBLIC/INTERNAL are not offered — an onboarding document
 * is never below Confidential. */
export class CreateCustomerDocumentDto {
  @IsIn(['CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL'] as const)
  classification!: Extract<
    DataClassification,
    'CONFIDENTIAL' | 'HIGHLY_CONFIDENTIAL'
  >;

  @IsString()
  @Length(1, 255)
  fileName!: string;

  @IsString()
  @Length(1, 500)
  storageRef!: string;
}
