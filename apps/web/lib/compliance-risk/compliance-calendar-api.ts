// Process 51/Part 7.1 — the CBJ regulatory compliance calendar (backlog
// Part C #51's second checkbox: "a compliance calendar of regulatory
// obligations with owner, due date, and evidence-of-submission tracking").
// Reads/writes apps/api's /compliance-calendar endpoints.
// compliance-calendar.manage (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export interface ComplianceCalendarItem {
  id: string;
  obligationName: string;
  ownerUserId: string;
  dueDate: string;
  evidenceOfSubmissionRef: string | null;
  submittedAt: string | null;
  isSubmitted: boolean;
  isOverdue: boolean;
}

export function listComplianceCalendarItems(
  opts: { ownerUserId?: string; overdueOnly?: boolean } = {},
): Promise<ComplianceCalendarItem[]> {
  const params = new URLSearchParams();
  if (opts.ownerUserId) params.set('ownerUserId', opts.ownerUserId);
  if (opts.overdueOnly) params.set('overdueOnly', 'true');
  const qs = params.toString();
  return apiGet(`/compliance-calendar${qs ? `?${qs}` : ''}`);
}

export function createComplianceCalendarItem(body: {
  obligationName: string;
  ownerUserId: string;
  dueDate: string;
}): Promise<ComplianceCalendarItem> {
  return apiPost('/compliance-calendar', body);
}

export function recordComplianceSubmission(
  id: string,
  body: { evidenceOfSubmissionRef: string },
): Promise<ComplianceCalendarItem> {
  return apiPost(`/compliance-calendar/${id}/record-submission`, body);
}
