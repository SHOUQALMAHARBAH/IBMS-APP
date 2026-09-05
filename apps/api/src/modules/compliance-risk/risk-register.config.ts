import type { Prisma } from '@ibms/db';

/**
 * Process 53/Part 5 (narrative process 37, "إدارة مخاطر الوسيط نفسه") — the
 * broker's own risk register (backlog Part C #53-54's first checkbox: "A
 * generic risk register covering the six categories the source explicitly
 * names: operational/cyber/financial/compliance/reputational — Professional
 * Indemnity gets its own, deeper table"). The pure, deterministic core: the
 * risk-type domain and the view/audit-snapshot builders.
 *
 * `RiskRegisterItem` (Part 5/7.1 core schema) pre-existed and needs no
 * widening — `riskType`/`description`/`mitigationAction`/`status`/
 * `loggedAt`/`closedAt` already cover the record. **No migration, no seed
 * change** — `risk-register.manage`
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) was pre-seeded ahead
 * of time. Not a `WorkflowTransitionService` entity, no maker/checker, no
 * `SlaTimer` — a factual log, the `RetentionCase`/#46 shape (`status`: plain
 * string `open -> closed`, no richer lifecycle because the bare schema has
 * none).
 *
 * Professional Indemnity is the sixth category the source names but is
 * deliberately EXCLUDED from `riskType` here — it gets its own deeper model
 * (`ProfessionalIndemnityPolicy` / `ProfessionalIndemnityRiskEvent`, see
 * `pi-policy.config.ts` / `pi-risk-event.config.ts`), so a caller cannot log
 * a PI exposure through this generic register at all.
 *
 * `ibms-brain/meta/context/operational-pi-risk.md`.
 */

export const RISK_REGISTER_TYPES = [
  'operational',
  'cyber',
  'financial',
  'compliance',
  'reputational',
] as const;
export type RiskRegisterType = (typeof RISK_REGISTER_TYPES)[number];

export const RISK_REGISTER_STATUSES = ['open', 'closed'] as const;
export type RiskRegisterStatus = (typeof RISK_REGISTER_STATUSES)[number];

/** Cap on a book-wide `RiskRegisterItem` list. */
export const RISK_REGISTER_READ_LIMIT = 5000;

export interface RiskRegisterItemRow {
  id: string;
  riskType: string;
  description: string;
  mitigationAction: string | null;
  status: string;
  loggedAt: Date;
  closedAt: Date | null;
}

export interface RiskRegisterItemView {
  id: string;
  riskType: string;
  description: string;
  mitigationAction: string | null;
  status: string;
  loggedAt: string;
  closedAt: string | null;
}

export function deriveRiskRegisterItemView(
  row: RiskRegisterItemRow,
): RiskRegisterItemView {
  return {
    id: row.id,
    riskType: row.riskType,
    description: row.description,
    mitigationAction: row.mitigationAction,
    status: row.status,
    loggedAt: row.loggedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

/** CREATE/UPDATE audit `afterValue` — `description`/`mitigationAction` are
 * internal risk-register narratives Compliance/a Manager write about the
 * broker's own operations, the `BrokerLicense.scopeOfAuthorization`
 * reasoning; `NO_FULL_ACCOUNT_NUMBER` is still applied at the DTO layer,
 * defense in depth (an operational-risk description could still name a
 * counterparty's account details). */
export function riskRegisterItemAuditSnapshot(
  input: RiskRegisterItemRow,
): Prisma.InputJsonObject {
  return {
    riskRegisterItemId: input.id,
    riskType: input.riskType,
    description: input.description,
    mitigationAction: input.mitigationAction,
    status: input.status,
    loggedAt: input.loggedAt.toISOString(),
    closedAt: input.closedAt ? input.closedAt.toISOString() : null,
  };
}
