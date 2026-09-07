// Backlog Part D §5.1 item #9 — the DPO Workspace aggregate screen.
// dpo-workspace.view (DPO) gates the whole surface.

import { apiGet } from '../auth/api-client';

export interface DsrQueueItem {
  id: string;
  type: string;
  status: string;
  slaDueAt: string;
  daysUntilDue: number;
  isOverdue: boolean;
}
export interface IncidentRegisterItem {
  id: string;
  title: string;
  severity: string;
  status: string;
}
export interface DpiaRegisterItem {
  id: string;
  subjectDescription: string;
  outcome: string;
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
