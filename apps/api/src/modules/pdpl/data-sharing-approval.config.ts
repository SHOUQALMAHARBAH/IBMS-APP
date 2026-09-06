import type { Prisma } from '@ibms/db';

export const DATA_SHARING_SLA_WORKFLOW = 'data_sharing_decision';

/**
 * M08 — Third Parties & Data Sharing (backlog Part D §5.1, Process #52;
 * PRIV-SRS-01 M08). One-off, non-recurring data shares outside a standing
 * vendor relationship — `vendorId` is optional precisely so a share can be
 * logged with no `Vendor` row at all (a genuinely one-off recipient), which
 * is what "separate from the standing vendor relationship" means here.
 *
 * **Mandatory risk tiering before any share** is enforced by calling
 * backlog #71's already-built, previously-uncalled
 * `computeDataShareReadiness()` (`supporting-operations/vendor.config.ts`)
 * live — the first real consumer of that pure function, closing the "no
 * live enforcement call site yet" gap #71's own header comment flagged.
 * The check only runs when `vendorId` is set AND `isRegulatoryChannel` is
 * false — "regulatory channels ... are exempt from the standard
 * vendor-risk assessment" (the backlog's own words) is modeled as skipping
 * ONLY this one check, never the classification/channel check below, which
 * always runs regardless of `isRegulatoryChannel` ("remain subject to
 * classification and minimum-necessary-data checks").
 *
 * **Classification/channel discipline** reuses the already-built
 * `assertSecureChannel()` (`modules/security/secure-channel.util.ts`) —
 * CONFIDENTIAL/HIGHLY_CONFIDENTIAL data may only pick a channel on the
 * secure list, unconditionally.
 *
 * **"Minimum-necessary-data checks"** has no dedicated schema field to
 * persist a structured attestation against — `description` (mandatory,
 * free text) is the only place this reasoning can be recorded, so the DTO
 * enforces a real minimum length on it rather than accepting a placeholder
 * string. This is a documented scope limit, not a claim that a structured
 * data-minimization review is enforced.
 *
 * **The model tracks approval, not a status enum** — a decision is
 * "approved" (`approvedByUserId` + `decidedAt` both set) or "declined"
 * (`decidedAt` set, `approvedByUserId` left null) — both independently
 * nullable columns, no migration needed for the decline path. The DB
 * `CHECK` constraint (`DataSharingApproval_maker_checker_distinct`,
 * migration `20260826091424`) and `assertDifferentActors` both only
 * compare `approvedByUserId` against `requestedByUserId`, so a decline
 * (which never sets `approvedByUserId`) trivially satisfies both — there is
 * no maker/checker distinct-actor requirement to enforce on a decline.
 *
 * `slaDueAt` (`data_sharing_decision`: 3 business days, 1 for the
 * regulatory-channel fast track via `SlaTimerService.computeDueAt`'s
 * `regulatoryChannel` option) is a mandatory inline column (unlike
 * `DisposalBatch.slaDueAt`, nullable and set later) — computed and
 * persisted at `create()` time, plus a matching generic `SlaTimer` row
 * started so the #43 SLA dashboard picks it up (`DataSharingApproval` is
 * already in `SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES`).
 */
export interface DataSharingApprovalRow {
  id: string;
  vendorId: string | null;
  description: string;
  classification: string;
  channel: string;
  isRegulatoryChannel: boolean;
  requestedByUserId: string;
  approvedByUserId: string | null;
  slaDueAt: Date;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface DataSharingApprovalView {
  id: string;
  vendorId: string | null;
  description: string;
  classification: string;
  channel: string;
  isRegulatoryChannel: boolean;
  requestedByUserId: string;
  approvedByUserId: string | null;
  slaDueAt: string;
  decidedAt: string | null;
  createdAt: string;
  /** `decidedAt !== null && approvedByUserId !== null`. */
  isApproved: boolean;
  /** `decidedAt !== null && approvedByUserId === null`. */
  isDeclined: boolean;
  /** `decidedAt === null`. */
  isPending: boolean;
}

export function deriveDataSharingApprovalView(
  row: DataSharingApprovalRow,
): DataSharingApprovalView {
  const decided = row.decidedAt !== null;
  const approved = decided && row.approvedByUserId !== null;
  return {
    id: row.id,
    vendorId: row.vendorId,
    description: row.description,
    classification: row.classification,
    channel: row.channel,
    isRegulatoryChannel: row.isRegulatoryChannel,
    requestedByUserId: row.requestedByUserId,
    approvedByUserId: row.approvedByUserId,
    slaDueAt: row.slaDueAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isApproved: approved,
    isDeclined: decided && !approved,
    isPending: !decided,
  };
}

/** Staff-authored operational free text (what/why is being shared) — the
 * DSR precedent for what belongs in an audit snapshot. */
export function dataSharingApprovalAuditSnapshot(
  row: DataSharingApprovalRow,
): Prisma.InputJsonObject {
  return {
    dataSharingApprovalId: row.id,
    vendorId: row.vendorId,
    description: row.description,
    classification: row.classification,
    channel: row.channel,
    isRegulatoryChannel: row.isRegulatoryChannel,
  };
}
