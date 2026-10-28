import type { CombinedDutyActOnRecord } from "../../components/ui/CombinedDutyOnRecord";
// Process 55/Part 6.2/Part 7.4 — Incident Management (backlog Part C #55).
// Reads/writes apps/api's /incidents endpoints. incident.report (broad)
// gates create+read; incident.contain (Admin/Compliance) gates the
// operational response; incident.classify (DPO + Executive Management)
// gates classify/co-sign/notify-senior-management; incident.notify-regulator
// (DPO/Compliance) gates the external filings.

import { apiGet, apiPost } from "../auth/api-client";

export const INCIDENT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export const INCIDENT_REGULATORS = [
  "CBJ",
  "NCSC",
  "Personal_Data_Protection_Council",
];

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentStatus =
  | "REPORTED"
  | "CONTAINED"
  | "IMPACT_ASSESSED"
  | "CLASSIFIED"
  | "NOTIFIED"
  | "RECOVERED"
  | "CLOSED";

export type IncidentClassification =
  "NOT_YET_CLASSIFIED" | "MATERIAL" | "NON_MATERIAL";

export interface IncidentReport {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedAt: string;
  containedAt: string | null;
  impactAssessedAt: string | null;
  classification: IncidentClassification;
  classifiedByDpoUserId: string | null;
  seniorManagementCoSignUserId: string | null;
  /**
   * Part 4 step 5 — present when ONE person both classified this incident and co-signed that
   * classification, in an office that declared COMBINED. A classification is the decision that a regulator
   * and the affected data subjects either do or do not get told, and the co-sign stamp reads as filled
   * either way.
   */
  classificationCombinedDutyAct: CombinedDutyActOnRecord | null;
  seniorManagementNotifiedAt: string | null;
  notifiedRegulators: string[];
  notifiedAt: string | null;
  affectedDataSubjectsNotifiedAt: string | null;
  rootCauseAnalysis: string | null;
  recoveredAt: string | null;
  closedAt: string | null;
  isContainmentOverdue: boolean;
  /**
   * OWNER DECISION 56 — PRIV-SRS-02's `containment_actions`, newest first.
   *
   * WHAT WAS ACTUALLY DONE. Her words were «بس بغيّر الحالة إلى تم احتوائه»: the status
   * changed and there was nothing else to show, because the route took no body. This is
   * the answer, and the api sends it on every read.
   *
   * WHO AND WHEN, PER ACTION — the two facts the dictionary types, and the whole reason
   * this is a child table rather than a text column. A log rendered as a joined string
   * of descriptions would discard both.
   *
   * `actionTakenByUserId` is a UUID and stays on the wire, NOT on the screen: decision
   * 48's resolver answers *who did this* and the api sends the resolved name beside it.
   * `actionTakenByName` is null when the id did not resolve — that column carries no FK
   * (the schema's dominant pattern, 96 of 115 `*UserId` columns), so a deleted account
   * is representable. NULL IS NO NAME and must never be filled from the id.
   */
  containmentActions: {
    id: string;
    description: string;
    actionTakenByUserId: string;
    actionTakenByName: string | null;
    takenAt: string;
  }[];
  /** PRIV-SOP-09 step 4's three outputs. All three or none — enforced by a row-level
   *  CHECK once `impactAssessedAt` is set. */
  touchesPersonalData: boolean | null;
  dataCategoriesAffected: string | null;
  subjectsAffectedEstimate: number | null;
  /** `occurred_date` — distinct from `reportedAt`, which is `detected_date`. */
  occurredAt: string | null;
  reportedByUserId: string | null;
}

export function listIncidents(
  opts: { status?: string; severity?: string; classification?: string } = {},
): Promise<IncidentReport[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.severity) params.set("severity", opts.severity);
  if (opts.classification) params.set("classification", opts.classification);
  const qs = params.toString();
  return apiGet(`/incidents${qs ? `?${qs}` : ""}`);
}

export function createIncident(body: {
  title: string;
  description: string;
  severity: string;
}): Promise<IncidentReport> {
  return apiPost("/incidents", body);
}

/**
 * OWNER DECISION 56 — both acts take a MANDATORY body now. They posted `{}`, which is
 * why pressing either changed the status and recorded nothing.
 *
 * The shapes are PRIV-SRS-02's and PRIV-SOP-09 step 4's rather than this file's; the api
 * DTOs carry the transcription and the reasoning.
 */
/**
 * Mirrors the api's `DECLARATION_REASON_MIN_LENGTH` (`common/declaration-reason.ts`),
 * which is the one home for the floor a DECLARATION's free text must clear. The server
 * is the authority; this only gates the button, so the screen does not send a request
 * it already knows will be refused.
 *
 * Deliberately NOT `COMBINED_DUTY_MIN_LENGTH`, which is the same number today: that
 * constant is named after the combined-duty reason, and a containment description
 * silently following it if the two ever diverge is a 400 nobody predicted.
 */
export const CONTAINMENT_DESCRIPTION_MIN_LENGTH = 10;

export interface ContainIncidentInput {
  description: string;
}

export interface AssessIncidentImpactInput {
  touchesPersonalData: boolean;
  dataCategoriesAffected: string;
  subjectsAffectedEstimate: number;
}

export function containIncident(
  id: string,
  body: ContainIncidentInput,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/contain`, body);
}

export function assessIncidentImpact(
  id: string,
  body: AssessIncidentImpactInput,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/assess-impact`, body);
}

export function classifyIncident(
  id: string,
  classification: "MATERIAL" | "NON_MATERIAL",
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/classify`, { classification });
}

export function coSignIncident(
  id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<IncidentReport> {
  return apiPost(
    `/incidents/${id}/co-sign`,
    combinedDutyReason ? { combinedDutyReason } : {},
  );
}

export function notifyIncidentSeniorManagement(
  id: string,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/notify-senior-management`, {});
}

export function notifyIncidentRegulators(
  id: string,
  regulators: string[],
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/notify-regulators`, { regulators });
}

export function notifyIncidentAffectedSubjects(
  id: string,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/notify-affected-subjects`, {});
}

export function recoverIncident(id: string): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/recover`, {});
}

export function closeIncident(
  id: string,
  rootCauseAnalysis: string,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/close`, { rootCauseAnalysis });
}
