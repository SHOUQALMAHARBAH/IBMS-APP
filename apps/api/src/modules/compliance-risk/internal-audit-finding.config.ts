import type { Prisma } from '@ibms/db';

/**
 * Process 57 (backlog Part C #57, Domain F — closes Domain F) — Internal
 * Audit. First checkbox: "Record audit findings, remediation path, and
 * closure." `InternalAuditFinding` (Part 5/7.1 core schema) pre-existed and
 * needs no widening — `auditPeriodLabel`/`finding`/`remediationAction`/
 * `status`/`loggedAt`/`closedAt` already cover the record, the exact same
 * bare shape as `RiskRegisterItem` (#53-54) one model up in the same file.
 * **No migration, no seed change** — `internal-audit.record`
 * (`[COMPLIANCE_OFFICER]`) and `internal-audit.close`
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) were pre-seeded ahead
 * of time, as two DISTINCT permissions rather than one combined "manage"
 * the way `risk-register.manage` is — deliberately: only Compliance may
 * RECORD a finding, but a Manager may also help see one through
 * remediation to closure. Not a `WorkflowTransitionService` entity, no
 * maker/checker, no `SlaTimer` — a factual log, `status`: plain string
 * `open -> closed`, the `RiskRegisterItem`/`RetentionCase` shape.
 *
 * `ibms-brain/meta/context/internal-audit-and-external-auditor-access.md`.
 */

export const INTERNAL_AUDIT_FINDING_STATUSES = ['open', 'closed'] as const;
export type InternalAuditFindingStatus =
  (typeof INTERNAL_AUDIT_FINDING_STATUSES)[number];

/** Cap on a book-wide `InternalAuditFinding` list. */
export const INTERNAL_AUDIT_FINDING_READ_LIMIT = 5000;

export interface InternalAuditFindingRow {
  id: string;
  auditPeriodLabel: string;
  finding: string;
  remediationAction: string | null;
  status: string;
  loggedAt: Date;
  closedAt: Date | null;
}

export interface InternalAuditFindingView {
  id: string;
  auditPeriodLabel: string;
  finding: string;
  remediationAction: string | null;
  status: string;
  loggedAt: string;
  closedAt: string | null;
}

export function deriveInternalAuditFindingView(
  row: InternalAuditFindingRow,
): InternalAuditFindingView {
  return {
    id: row.id,
    auditPeriodLabel: row.auditPeriodLabel,
    finding: row.finding,
    remediationAction: row.remediationAction,
    status: row.status,
    loggedAt: row.loggedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

/** CREATE/UPDATE audit `afterValue` — `finding`/`remediationAction` are
 * internal audit narratives Compliance writes about the broker's own
 * operations, the `RiskRegisterItem`/`BrokerLicense.scopeOfAuthorization`
 * reasoning; `NO_FULL_ACCOUNT_NUMBER` is still applied at the DTO layer,
 * defense in depth. */
export function internalAuditFindingAuditSnapshot(
  input: InternalAuditFindingRow,
): Prisma.InputJsonObject {
  return {
    internalAuditFindingId: input.id,
    auditPeriodLabel: input.auditPeriodLabel,
    finding: input.finding,
    remediationAction: input.remediationAction,
    status: input.status,
    loggedAt: input.loggedAt.toISOString(),
    closedAt: input.closedAt ? input.closedAt.toISOString() : null,
  };
}
