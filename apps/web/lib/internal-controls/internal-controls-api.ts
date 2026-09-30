// Process 56 — Internal Controls (Maker/Checker) (backlog Part C #56, Domain
// F). Reads apps/api's GET /internal-controls/self-approval-audit: a
// registry-driven scan across every maker/checker pair in the schema for a
// self-approval violation. `internal-controls.view`.

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

/** Part 4 step 6 — one DECLARED combined-duty act, as the self-approval report shows it. */
export interface CombinedDutyReportRow {
  id: string;
  actorUserId: string;
  actorName: string | null;
  at: string;
  entity: string;
  entityId: string;
  /** The CHECK constraint the act excuses, so the act and the database rule cannot drift apart. */
  pair: string;
  reason: string;
  /** The HAT — the roles that actually granted the checker permission. */
  roles: string[];
  hatAmbiguous: boolean;
  /** A person reviewing their OWN access. These sort first and render flagged. */
  accessSelfReview: boolean;
}

export interface CombinedDutyReport {
  office: {
    mode: string;
    declaredAt: string | null;
    declaredByUserId: string | null;
    declaredByName: string | null;
  };
  rows: CombinedDutyReportRow[];
  accessSelfReviewCount: number;
  totalCount: number;
  truncated: boolean;
}

export function getCombinedDutyActs(): Promise<CombinedDutyReport> {
  return apiGet<CombinedDutyReport>('/internal-controls/combined-duty-acts');
}
