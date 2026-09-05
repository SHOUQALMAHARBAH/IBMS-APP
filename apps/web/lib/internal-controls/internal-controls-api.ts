// Process 56 — Internal Controls (Maker/Checker) (backlog Part C #56, Domain
// F). Reads apps/api's GET /internal-controls/self-approval-audit: a
// registry-driven scan across every maker/checker pair in the schema for a
// self-approval violation. `internal-controls.audit`.

import { apiGet } from '../auth/api-client';

export interface SelfApprovalViolation {
  entityType: string;
  pairLabel: string;
  entityId: string;
  makerField: string;
  checkerField: string;
  userId: string;
  dbCheckConstraint: string | null;
}

export interface InternalControlsAuditReportByPair {
  entityType: string;
  pairLabel: string;
  rowsChecked: number;
  violationCount: number;
  dbCheckConstraint: string | null;
  dormant: boolean;
  truncated: boolean;
}

export interface InternalControlsAuditReport {
  generatedAt: string;
  pairsScanned: number;
  totalRowsChecked: number;
  violations: SelfApprovalViolation[];
  byPair: InternalControlsAuditReportByPair[];
}

export function getSelfApprovalAudit(): Promise<InternalControlsAuditReport> {
  return apiGet('/internal-controls/self-approval-audit');
}
