/**
 * Process 69 (backlog Part C #69, Domain H) — Cybersecurity. The backlog's
 * own annotation: "fully covered by Part A + `IncidentReport` +
 * `InformationAsset`." Verified before accepting that at face value (see
 * `ibms-brain/meta/context/information-asset-inventory.md`):
 *
 *   - Part A's cybersecurity-relevant items (A.1 Auth/Sessions, A.3
 *     Encryption/Key Management, A.4 Immutable Audit Trail, A.9 Data
 *     Masking, A.10 Infra/Deployment) are real but each carries its OWN
 *     already-tracked gap (hardware-token MFA, a real KMS/HSM,
 *     encryption-at-rest, unwired `assertSecureChannel`/
 *     `assertExportAllowed` callers, Dev/Test/UAT/Prod separation) — all
 *     documented in this repo's own README § Known gaps, not restated here.
 *   - `IncidentReport` (#55) is genuinely built and its own doc comment
 *     already frames it as a "unified SECURITY + personal-data breach
 *     workflow" — a real, working cyber-incident reporting path, though it
 *     has no dedicated cyber/category field (incidents are typed by
 *     free-text `title`/`description`, not a taxonomy).
 *   - `InformationAsset` (ISO 27001 Clause 8.1 asset inventory) was
 *     COMPLETELY DORMANT — zero prior application code anywhere in this
 *     repo, unlike `IncidentReport`. This is the one genuine gap #69 needed
 *     to close, the same "dormant model, first real writer" shape #58-67
 *     repeatedly found.
 */

/** The exact 6-value set from `InformationAsset.assetType`'s own schema doc
 * comment. */
import type { DataClassification } from '@ibms/db';

export const ASSET_TYPES = [
  'customer_data',
  'policy_data',
  'document_store',
  'backup',
  'integration',
  'other',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * ITEM 1 — THE VIEW LAYER THIS MODULE DID NOT HAVE. Before this, `InformationAssetService` returned
 * the raw Prisma `InformationAsset` from all four of its paths, so the screen had nothing but
 * `ownerUserId` to render and rendered it: the asset inventory named its owner by uuid, in the one
 * register whose whole purpose is saying WHO is accountable for a classified asset.
 *
 * `ownerName` is REQUIRED on the view and never optional — four paths project it (create, list, get,
 * update) and an optional field would let three keep sending nothing while the list carried a name,
 * which is the `IncidentReport.load()` defect.
 *
 * NULLABLE in value: `ownerUserId` is NOT NULL and carries no foreign key on this model (measured —
 * the service checks the owner exists in application code at both write paths), so an owner whose
 * account was later deleted is a REAL state. It reports NO name, never the uuid.
 */
export interface InformationAssetView {
  id: string;
  name: string;
  assetType: string;
  ownerUserId: string;
  ownerName: string | null;
  classification: DataClassification;
  createdAt: string;
}

/** Pure. Resolved names come from `UserRepository.displayNamesForUserIds` — decision 48's single
 * answer to "who is this" — never from a second read of `User.fullName` at a call site. A REQUIRED
 * second parameter, so the compiler names every projection site. */
export function deriveInformationAssetView(
  row: InformationAssetRow,
  ownerNames: Map<string, string>,
): InformationAssetView {
  return {
    id: row.id,
    name: row.name,
    assetType: row.assetType,
    ownerUserId: row.ownerUserId,
    ownerName: ownerNames.get(row.ownerUserId) ?? null,
    classification: row.classification,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface InformationAssetRow {
  id: string;
  name: string;
  assetType: string;
  ownerUserId: string;
  classification: DataClassification;
  createdAt: Date;
}
