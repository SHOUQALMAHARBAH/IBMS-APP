/**
 * Process 67 (backlog Part C #67, Domain H) — Procurement — built the
 * FOUNDATIONAL `Vendor` CRUD (name, vendorType) and deliberately left
 * `riskTier`/`annualReviewDueAt`/`terminationDataReturnConfirmedAt`/
 * `accessRevokedAt` untouched. Process 71 (backlog Part C #71, Domain H) —
 * Vendor Management — is what this file's second half builds: those four
 * fields, plus `DataProcessingAgreement`. Same model, same module — #67's
 * own module doc comment already said #71 would extend it rather than
 * build a parallel one.
 *
 * Three checkboxes:
 *
 *   1. Risk tiering (low/medium/high) before any data share or access
 *      grant. There is no "data share" or "access grant" ACTION anywhere
 *      in this codebase to hook a live gate into yet — `DataSharingApproval`
 *      (M08) has zero prior writer (flagged `dormant: true` in
 *      `internal-controls.config.ts`'s `MAKER_CHECKER_REGISTRY`, same as
 *      `DataProcessingAgreement` was before this process), and no model
 *      represents a generic "access grant" at all. This process therefore
 *      builds `computeDataShareReadiness()` as a pure, queryable rule
 *      (`GET /vendors/:id/data-share-readiness`) rather than inventing the
 *      M08 workflow — an honest, forward-compatible gate with NO live
 *      enforcement call site yet, not a claim that anything is actually
 *      blocked today.
 *   2. A mandatory DPA for Medium/High tier, additional DPO approval for
 *      High tier before the first share — `DataProcessingAgreement`'s own
 *      doc comment already states this; its maker/checker pair
 *      (`assessedByUserId`/`dpoApprovedByUserId`) already has a DB `CHECK`
 *      constraint (`DataProcessingAgreement_maker_checker_distinct`, added
 *      in the A.5 foundational work) and is already in
 *      `common/maker-checker.util.ts`'s own covered-pairs table — this
 *      process is that pair's first real writer. `dpa.approve` (DPO only)
 *      was already pre-seeded as a DISTINCT permission code from
 *      `vendor.manage` — the maker-checker default (two codes), not the
 *      `incident.classify` shared-permission exception.
 *   3. Mandatory annual review + confirmation of data return/destruction on
 *      termination + access revocation within 2 business days.
 *      `vendor_annual_review` was already a registered `SLA_REGISTRY` entry
 *      with zero prior caller (the #60/#61/#66 dormant-SLA-entry shape) —
 *      this process is its first. `vendor_termination_access_revocation`
 *      (2 business days) had NO registry entry at all — a genuine gap, not
 *      a dormant-but-present one; both `pdpl-sla-timers.md`'s lex table and
 *      `sla-registry.config.ts` needed a new row, sourced directly from
 *      this backlog line's own "2 business days" text (the M03 consent-
 *      withdrawal precedent for sourcing an SLA value straight from the
 *      backlog rather than inventing one).
 *
 * No new permission, no migration — `vendor.manage` and `dpa.approve` were
 * both already pre-seeded (Domain H's "seed before code" pattern, broken
 * once by #69, holding again here).
 */

/** The exact 7-value set from `Vendor.vendorType`'s own schema doc comment
 * — validated here so a caller can't write an arbitrary string into a
 * column with no DB-level enum. `'other'` is the value #67's own
 * procurement use case maps to (non-insurance operational vendors);
 * the other six are #71's/Part D's insurance-side and outsourced-function
 * vendor types. */
export const VENDOR_TYPES = [
  'insurer',
  'reinsurer',
  'loss_adjuster',
  'it_cloud',
  'printing_archiving',
  'marketing_call_centre',
  'other',
] as const;

export type VendorType = (typeof VENDOR_TYPES)[number];

/** The exact 3-value set from `Vendor.riskTier`'s own schema doc comment. */
export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW = 'vendor_annual_review';
export const VENDOR_TERMINATION_ACCESS_REVOCATION_SLA_WORKFLOW =
  'vendor_termination_access_revocation';

/** Medium and High tier both require a DPA on file before the first data
 * share (Part 7.5 / M07); Low tier does not. */
export function dpaRequiredForTier(tier: RiskTier): boolean {
  return tier === 'medium' || tier === 'high';
}

/** Only High tier additionally requires DPO approval on that DPA before
 * the first data share. */
export function dpoApprovalRequiredForTier(tier: RiskTier): boolean {
  return tier === 'high';
}

export interface ActiveDpaSummary {
  id: string;
  signedAt: Date | null;
  dpoApprovedByUserId: string | null;
}

export interface DataShareReadiness {
  vendorId: string;
  riskTier: RiskTier | null;
  ready: boolean;
  reasons: string[];
}

/** Pure: backlog #71's checkbox 1, "risk tiering ... before any data share
 * or access grant" — a queryable readiness computation, not a live gate
 * (see this file's header comment for why no live call site exists yet).
 * `activeDpa` is the vendor's own currently-signed, unexpired
 * `DataProcessingAgreement` (or `null` if none) — resolving which DPA
 * counts as "active" is the repository's job
 * (`findActiveByVendorId`), not this function's. */
export function computeDataShareReadiness(
  vendorId: string,
  riskTier: string | null,
  activeDpa: ActiveDpaSummary | null,
): DataShareReadiness {
  const reasons: string[] = [];
  const tier = riskTier as RiskTier | null;

  if (!tier) {
    reasons.push('Risk tier has not been assigned yet.');
    return { vendorId, riskTier: tier, ready: false, reasons };
  }

  if (dpaRequiredForTier(tier)) {
    if (!activeDpa || !activeDpa.signedAt) {
      reasons.push(
        'No signed Data Processing Agreement is on file for this tier.',
      );
    } else if (
      dpoApprovalRequiredForTier(tier) &&
      !activeDpa.dpoApprovedByUserId
    ) {
      reasons.push(
        'High-tier vendors require DPO approval on the Data Processing Agreement before the first data share.',
      );
    }
  }

  return { vendorId, riskTier: tier, ready: reasons.length === 0, reasons };
}
