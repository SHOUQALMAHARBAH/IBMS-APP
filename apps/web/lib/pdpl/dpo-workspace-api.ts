// Backlog Part D §5.1 item #9 — the DPO Workspace aggregate screen.
// dpo-workspace.view (DPO) gates the whole surface.

import { apiGet } from '../auth/api-client';

export type DsrType = 'ACCESS' | 'CORRECTION' | 'DELETION' | 'OBJECTION';

export type DsrStatus =
  | 'RECEIVED'
  | 'IDENTITY_VERIFIED'
  | 'IN_PROGRESS'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'REJECTED'
  | 'CLOSED';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'REPORTED'
  | 'CONTAINED'
  | 'IMPACT_ASSESSED'
  | 'CLASSIFIED'
  | 'NOTIFIED'
  | 'RECOVERED'
  | 'CLOSED';

export type DpiaOutcome = 'AUTO_APPROVED' | 'DPO_REVIEW_REQUIRED' | 'ESCALATED_FULL_DPIA';

export interface DsrQueueItem {
  id: string;
  type: DsrType;
  status: DsrStatus;
  slaDueAt: string;
  daysUntilDue: number;
  isOverdue: boolean;
}
export interface IncidentRegisterItem {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
}
export interface DpiaRegisterItem {
  id: string;
  subjectDescription: string;
  outcome: DpiaOutcome;
  dpoReviewDueAt: string | null;
}
export interface LegalHoldRegisterItem {
  id: string;
  scope: string;
  nextReviewDueAt: string;
  isActive: boolean;
}
export interface CrossBorderTransferRegisterItem {
  id: string;
  destinationCountry: string;
  legalBasis: string;
  transferredAt: string;
}

export interface DpoWorkspaceSummary {
  generatedAt: string;
  consentStatus: { activeCount: number; withdrawnCount: number; declinedCount: number };
  dsrQueue: DsrQueueItem[];
  incidentRegister: IncidentRegisterItem[];
  dpiaRegister: DpiaRegisterItem[];
  legalHoldRegister: LegalHoldRegisterItem[];
  crossBorderTransferRegister: CrossBorderTransferRegisterItem[];
}

export function getDpoWorkspaceSummary(): Promise<DpoWorkspaceSummary> {
  return apiGet('/dpo-workspace/summary');
}
