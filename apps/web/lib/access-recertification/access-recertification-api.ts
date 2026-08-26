// Part 10.1 / Process #40 — talks to apps/api's rbac module
// (access-recertification.controller.ts). Mirrors lib/auth/auth-api.ts's
// conventions (thin typed wrappers over apiGet/apiPost).

import { apiGet, apiPost } from '../auth/api-client';

export type RecertificationDecision = 'confirmed' | 'revoked' | 'changed';

export interface RecertificationItem {
  id: string;
  cycleId: string;
  cycleLabel: string;
  subjectUserId: string;
  subjectFullName: string;
  subjectEmail: string;
  subjectRoles: string[];
  reviewerUserId: string;
  decision: RecertificationDecision | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface RecertificationCycle {
  id: string;
  cycleLabel: string;
  startedAt: string;
  dueAt: string;
  closedAt: string | null;
}

// POST .../decision returns the raw AccessRecertificationItem (see
// AccessRecertificationService#decide) — NOT the enriched shape GET
// .../items returns. Deliberately narrower than RecertificationItem so a
// caller can't assume fields (subjectFullName, subjectRoles, ...) that
// genuinely aren't there — that mismatch used to crash the review table
// after a decision, since RecertificationItemsTable reads
// item.subjectRoles.includes(...) on every row.
export interface RecertificationDecisionResult {
  id: string;
  cycleId: string;
  subjectUserId: string;
  reviewerUserId: string;
  decision: RecertificationDecision;
  reviewedAt: string | null;
  createdAt: string;
}

export function listMyRecertificationItems(): Promise<RecertificationItem[]> {
  return apiGet('/access-recertification/items');
}

export function startRecertificationCycle(input: {
  cycleLabel: string;
  dueAt?: string;
}): Promise<RecertificationCycle> {
  return apiPost('/access-recertification/cycles', input);
}

export function decideRecertificationItem(
  itemId: string,
  decision: RecertificationDecision,
): Promise<RecertificationDecisionResult> {
  return apiPost(`/access-recertification/items/${itemId}/decision`, {
    decision,
  });
}
