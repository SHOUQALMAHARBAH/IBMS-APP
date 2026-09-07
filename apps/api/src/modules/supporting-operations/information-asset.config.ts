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
export const ASSET_TYPES = [
  'customer_data',
  'policy_data',
  'document_store',
  'backup',
  'integration',
  'other',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];
