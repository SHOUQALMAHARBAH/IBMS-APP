import { apiGet, apiPatch, apiPost } from "../auth/api-client";

// Configurable SLA policies (task Part A).
//
// The field that matters most on this screen is `isRegulatory`. It is computed
// SERVER-side from `sourceType` and must never be re-derived here: presenting
// an internal target as a legal requirement is the failure the whole feature
// exists to prevent, and that decision should have exactly one home.

export type SlaSourceType =
  "REGULATORY" | "INTERNAL_POLICY" | "CONTRACTUAL" | "OPERATIONAL" | "OTHER";

export type SlaPolicyStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export type SlaDurationUnit =
  "MINUTES" | "HOURS" | "BUSINESS_DAYS" | "CALENDAR_DAYS" | "MONTHS";

export interface SlaPolicy {
  id: string;
  policyCode: string;
  policyName: string;
  processType: string;
  workflowState: string | null;
  description: string | null;
  durationValue: number;
  durationUnit: SlaDurationUnit;
  calendarType: "JORDAN_STANDARD" | "CONTINUOUS_24_7" | "CUSTOM";
  customWeekendDays: number[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  timezone: string;
  sourceType: SlaSourceType;
  sourceReference: string | null;
  sourceDocument: string | null;
  sourceSection: string | null;
  /** Server-computed. TRUE only for `sourceType === 'REGULATORY'`. */
  isRegulatory: boolean;
  /** Ready-to-render, e.g. "Regulatory — PRIV-STD-01 §6.4". */
  sourceLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  escalationEnabled: boolean;
  warningThreshold: number;
  status: SlaPolicyStatus;
  escalations: {
    stageOrder: number;
    offsetValue: number;
    offsetUnit: SlaDurationUnit;
    escalateTo: string | null;
  }[];
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listSlaPolicies(filter?: {
  processType?: string;
  status?: SlaPolicyStatus;
}): Promise<SlaPolicy[]> {
  const params = new URLSearchParams();
  if (filter?.processType) params.set("processType", filter.processType);
  if (filter?.status) params.set("status", filter.status);
  const query = params.toString();
  return apiGet(`/sla/policies${query ? `?${query}` : ""}`);
}

export function getSlaPolicy(id: string): Promise<SlaPolicy> {
  return apiGet(`/sla/policies/${encodeURIComponent(id)}`);
}

/** Duration/calendar/escalation edits. Needs `sla.policy.manage`.
 *
 * Deliberately CANNOT change the source/citation — that is a different route
 * behind `sla.policy.regulatory` (see `updateSlaPolicySource`), because
 * "shorten this deadline" and "declare this deadline legally required" are
 * different decisions. */
export function updateSlaPolicy(
  id: string,
  patch: Partial<
    Pick<
      SlaPolicy,
      | "policyName"
      | "description"
      | "durationValue"
      | "durationUnit"
      | "calendarType"
      | "timezone"
      | "escalationEnabled"
      | "warningThreshold"
    >
  >,
): Promise<SlaPolicy> {
  return apiPatch(`/sla/policies/${encodeURIComponent(id)}`, patch);
}

export function activateSlaPolicy(id: string): Promise<SlaPolicy> {
  return apiPost(`/sla/policies/${encodeURIComponent(id)}/activate`, {});
}

export function deactivateSlaPolicy(id: string): Promise<SlaPolicy> {
  return apiPost(`/sla/policies/${encodeURIComponent(id)}/deactivate`, {});
}

/** Human-readable duration, e.g. "3 business days". Unit labels are
 * translated by the caller; this only handles the shape. */
export function durationUnitKey(unit: SlaDurationUnit): string {
  return `slaUnit${unit
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join("")}`;
}

/** Change what the system CLAIMS about an SLA's legal force. Needs
 * `sla.policy.regulatory` on top of `sla.policy.manage`. `REGULATORY` still
 * requires a named instrument — a 422, not a silent downgrade. */
export function updateSlaPolicySource(
  id: string,
  source: {
    sourceType: SlaSourceType;
    sourceReference?: string;
    sourceDocument?: string;
    sourceSection?: string;
  },
): Promise<SlaPolicy> {
  return apiPatch(`/sla/policies/${encodeURIComponent(id)}/source`, source);
}
