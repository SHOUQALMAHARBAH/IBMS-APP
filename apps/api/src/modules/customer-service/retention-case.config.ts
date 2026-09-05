import type { Prisma, RenewalStatus } from '@ibms/db';
import { isFollowUpDue } from '../../common/follow-up.util';

/**
 * Process 46 — Customer Retention (backlog Part C #46, Domain E — closes the
 * domain). The pure, deterministic core: the "should this open a retention
 * case" classifier, the `status` domain, and the view / audit-snapshot
 * shapes.
 *
 * `RetentionCase` pre-existed (Part 4 core schema) and needs no widening —
 * `customerId`, `reason`, `status`, `createdAt`, `closedAt` are already
 * everything a retention log needs. `RenewalCase.retentionEscalatedAt`
 * (Part 3.9 core schema) also pre-existed — a nullable timestamp clearly
 * provisioned for exactly this purpose, so it is the sweep's race-safe
 * "already escalated" guard; no migration.
 *
 * `ibms-brain/meta/context/customer-service-lifecycle.md` § "Customer
 * Retention (Process 46)".
 */

export const RETENTION_CASE_REASONS = [
  'renewal_inactivity',
  'lapse_risk',
] as const;
export type RetentionCaseReason = (typeof RETENTION_CASE_REASONS)[number];

export function isRetentionCaseReason(v: string): v is RetentionCaseReason {
  return (RETENTION_CASE_REASONS as readonly string[]).includes(v);
}

export const RETENTION_CASE_STATUSES = ['open', 'closed'] as const;
export type RetentionCaseStatus = (typeof RETENTION_CASE_STATUSES)[number];

export function isTerminalRetentionCaseStatus(status: string): boolean {
  return status === 'closed';
}

/** Cap on a book-wide `RetentionCase` list. */
export const RETENTION_CASE_READ_LIMIT = 5000;

/**
 * How many **business days** a `RenewalCase` may sit unresolved (not yet
 * `RENEWED` / `CANCELLED` / `LAPSED`) since it was `triggeredAt` before its
 * silence itself counts as a retention signal. **DRAFTED / UNSOURCED** —
 * Part 3.9 names a `leadTimeDays` default (90 calendar days before expiry)
 * but no inactivity-escalation figure; same drafted status as the #41 / #42
 * SLA figures and `CLAIM_LARGE_THRESHOLD_JOD` (#23). Reuses
 * `isFollowUpDue` — structurally the same "has a grace window elapsed since
 * a start timestamp" test as the RFQ (#12) / Claim (#27) follow-up sweeps.
 */
export const RENEWAL_INACTIVITY_THRESHOLD_BUSINESS_DAYS = 30;

/** A `RenewalCase` whose renewal cycle has concluded (successfully or not,
 * outside a retention signal) — never a candidate for escalation. `LAPSED`
 * is deliberately excluded from this set: it is not "concluded", it is the
 * `lapse_risk` trigger itself. */
const RENEWAL_CASE_CONCLUDED_STATUSES: readonly RenewalStatus[] = [
  'RENEWED',
  'CANCELLED',
];

export function isRenewalCaseConcluded(status: RenewalStatus): boolean {
  return RENEWAL_CASE_CONCLUDED_STATUSES.includes(status);
}

/**
 * Whether a `RenewalCase` should escalate to a `RetentionCase` right now,
 * and under which of the two documented reasons. Pure — no DB, `now`
 * injected so the sweep and its tests share one clock.
 *
 * Precedence: `LAPSED` (the renewal cycle already failed to convert) always
 * wins over inactivity — a lapsed case is a stronger, more urgent signal
 * than mere staleness, and the two are mutually exclusive by construction
 * (`LAPSED` is not in `RENEWAL_CASE_CONCLUDED_STATUSES`, so it always falls
 * through to the lapse check before the inactivity check runs).
 */
export function classifyRenewalCaseForRetention(
  renewalCase: { status: RenewalStatus; triggeredAt: Date },
  now: Date,
): RetentionCaseReason | null {
  if (renewalCase.status === 'LAPSED') return 'lapse_risk';
  if (isRenewalCaseConcluded(renewalCase.status)) return null;
  if (
    isFollowUpDue(
      renewalCase.triggeredAt,
      RENEWAL_INACTIVITY_THRESHOLD_BUSINESS_DAYS,
      now,
    )
  ) {
    return 'renewal_inactivity';
  }
  return null;
}

export interface RetentionCaseRow {
  id: string;
  customerId: string;
  reason: string;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
}

export interface RetentionCaseView {
  id: string;
  customerId: string;
  reason: string;
  status: string;
  isClosed: boolean;
  createdAt: string;
  closedAt: string | null;
}

export function deriveRetentionCaseView(
  row: RetentionCaseRow,
): RetentionCaseView {
  return {
    id: row.id,
    customerId: row.customerId,
    reason: row.reason,
    status: row.status,
    isClosed: isTerminalRetentionCaseStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

/** CREATE audit `afterValue` — ids + `reason` + `status`. No free text
 * exists on the model to guard or exclude either way. */
export function retentionCaseAuditSnapshot(input: {
  retentionCaseId: string;
  customerId: string;
  reason: string;
  status: string;
}): Prisma.InputJsonObject {
  return {
    retentionCaseId: input.retentionCaseId,
    customerId: input.customerId,
    reason: input.reason,
    status: input.status,
  };
}
