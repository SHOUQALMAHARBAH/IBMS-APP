import { Prisma } from '@ibms/db';

/**
 * M06 — Disposal Batch (backlog Part D §5.1, Process #52). Destruction is
 * ALWAYS dual control (Department Manager nominates, DPO approves —
 * `dpoApprovedByUserId != nominatedByUserId`, enforced by
 * `assertDifferentActors` AND the pre-existing
 * `DisposalBatch_maker_checker_distinct` DB CHECK, both since before this
 * module's first real writer) and ALWAYS produces a `CertificateOfDestruction`
 * before `CLOSED` is reachable. The 30-day execution SLA
 * (`SLA_REGISTRY`'s `disposal_batch_execution`, pre-seeded) starts at the
 * FINAL approval (`DPO_APPROVED`) — the model's own `slaDueAt` field
 * comment ("30 days from batch approval") sits directly after
 * `dpoApprovedAt`, not `managerApprovedAt`.
 *
 * **This module records the destruction workflow — it never executes a
 * live delete against any other table.** `method` (below) names an
 * EXTERNAL process (a certified vendor wipes drives, shreds paper); the
 * `EXECUTED` transition is a staff attestation that this happened, not a
 * DB operation this API performs. See
 * `ibms-brain/meta/context/data-retention-and-disposal.md`'s own
 * "Retention informs disposal eligibility; it does not execute disposal"
 * — `AuditLogEntry`'s own immutability trigger would need a deliberate,
 * documented bypass to ever be a real disposal TARGET, which is
 * deliberately out of scope here.
 */

export const DISPOSAL_METHODS = [
  'certified_secure_wipe_nist_800_88',
  'physical_destruction',
  'certified_shredding',
] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const DISPOSAL_BATCH_SLA_WORKFLOW = 'disposal_batch_execution';

export interface DisposalBatchRow {
  id: string;
  retentionScheduleItemId: string | null;
  status: string;
  nominatedByUserId: string;
  managerApprovedAt: Date | null;
  dpoApprovedByUserId: string | null;
  dpoApprovedAt: Date | null;
  method: string | null;
  executedAt: Date | null;
  slaDueAt: Date | null;
  createdAt: Date;
}

export interface DisposalBatchView {
  id: string;
  retentionScheduleItemId: string | null;
  status: string;
  nominatedByUserId: string;
  managerApprovedAt: string | null;
  dpoApprovedByUserId: string | null;
  dpoApprovedAt: string | null;
  method: string | null;
  executedAt: string | null;
  slaDueAt: string | null;
  createdAt: string;
  hasCertificateOfDestruction: boolean;
}

export function deriveDisposalBatchView(
  row: DisposalBatchRow,
  hasCertificateOfDestruction: boolean,
): DisposalBatchView {
  return {
    id: row.id,
    retentionScheduleItemId: row.retentionScheduleItemId,
    status: row.status,
    nominatedByUserId: row.nominatedByUserId,
    managerApprovedAt: row.managerApprovedAt
      ? row.managerApprovedAt.toISOString()
      : null,
    dpoApprovedByUserId: row.dpoApprovedByUserId,
    dpoApprovedAt: row.dpoApprovedAt ? row.dpoApprovedAt.toISOString() : null,
    method: row.method,
    executedAt: row.executedAt ? row.executedAt.toISOString() : null,
    slaDueAt: row.slaDueAt ? row.slaDueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    hasCertificateOfDestruction,
  };
}

export function disposalBatchAuditSnapshot(
  row: DisposalBatchRow,
): Prisma.InputJsonObject {
  return {
    disposalBatchId: row.id,
    retentionScheduleItemId: row.retentionScheduleItemId,
    status: row.status,
    nominatedByUserId: row.nominatedByUserId,
    dpoApprovedByUserId: row.dpoApprovedByUserId,
  };
}
