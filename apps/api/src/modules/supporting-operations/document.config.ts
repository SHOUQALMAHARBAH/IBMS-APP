import { DataClassification, DocumentCategory } from '@ibms/db';
import type { Prisma } from '@ibms/db';

/**
 * Process 70 (backlog Part C #70, Domain H) — Document Management. `Document`
 * (Part 4.2 — the electronic Insurance File) pre-exists in the core schema
 * with three prior writers (Policy issuance/attach #18-19, Claim
 * documentation #25, Customer onboarding #3-4), all of which only ever
 * create a version-1 row: `versionNumber`/`previousVersionId` and the
 * `deletionLocked`/`deletionOverrideByUserId` pair have sat dormant since
 * before this process — `audit-trail.repository.ts`'s own
 * `findDocumentVersionChain` doc comment already says as much ("no
 * application code creates a second version yet"). This process is the
 * first real writer for:
 *
 *   - a SECOND version of an existing `Document` (`previousVersionId`'s own
 *     `@unique` makes the chain race-safe the same way `Quotation`'s
 *     `reviseChain` is);
 *   - the deletion-lock override (`deletionLocked` true -> false,
 *     `deletionOverrideByUserId` stamped) and the delete it then permits;
 *   - the "highest classification present" rollup for a Policy's electronic
 *     file (`sensitive-data-handling.md` / `PRIV-STD-02` §6.7: "a file
 *     combining multiple classification levels is classified at the highest
 *     level present — never averaged").
 *
 * This is a single-actor privileged override, NOT the M06 Disposal dual
 * control (`roles-and-segregation-of-duties.md`: "the resulting
 * physical/technical destruction BATCH always requires dual control —
 * Department Manager sign-off plus DPO final approval"). That is a
 * separate, still-unbuilt process over `DisposalBatch`
 * (`raisedByUserId`/`approvedByUserId`, already flagged `dormant: true` in
 * `internal-controls.config.ts`'s `MAKER_CHECKER_REGISTRY`) — a batch
 * destruction decision under the PDPL retention schedule. `#70` is the
 * narrower, ad hoc, single-document override the schema's own
 * `deletionOverrideByUserId` field (singular) and the pre-seeded
 * `document.delete-override` permission (one code, `[ADMIN, DPO]` — not two
 * distinct maker/checker codes) both already anticipate.
 */

export const DOCUMENT_CATEGORIES = Object.values(DocumentCategory);
export const DATA_CLASSIFICATIONS = Object.values(DataClassification);

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  HIGHLY_CONFIDENTIAL: 3,
};

/** Pure: PRIV-STD-02 §6.7 — the highest classification among a set, never
 * averaged. `null` for an empty set (no documents to classify). */
export function highestClassification(
  classifications: DataClassification[],
): DataClassification | null {
  if (classifications.length === 0) return null;
  return classifications.reduce((highest, c) =>
    CLASSIFICATION_RANK[c] > CLASSIFICATION_RANK[highest] ? c : highest,
  );
}

export interface PolicyFileClassificationView {
  policyId: string;
  documentCount: number;
  highestClassification: DataClassification | null;
}

/** CREATE/DELETE audit snapshot for a `Document` row — like the #18-19
 * `policyDocumentAuditSnapshot` / #25 `claimDocumentAuditSnapshot`, this
 * excludes `fileName` and `storageRef`: a filename can itself name an
 * insured person or describe a medical event (HIGHLY_CONFIDENTIAL), and
 * `storageRef` is an internal object-storage key. Only ids / type /
 * category / classification. */
export function documentAuditSnapshot(row: {
  id: string;
  policyId: string | null;
  customerId: string | null;
  category: string;
  classification: string;
  versionNumber: number;
  previousVersionId: string | null;
  uploadedByUserId: string;
}): Prisma.InputJsonObject {
  return {
    documentId: row.id,
    policyId: row.policyId,
    customerId: row.customerId,
    category: row.category,
    classification: row.classification,
    versionNumber: row.versionNumber,
    previousVersionId: row.previousVersionId,
    uploadedByUserId: row.uploadedByUserId,
  };
}
