// Process 45 — Customer Feedback (backlog Part C #45, Domain E). Reads
// apps/api's /feedback endpoints: log a post-issuance / post-claim /
// post-renewal satisfaction survey response and list it. `feedback.log`
// (Sales).

import { apiGet, apiPost } from '../auth/api-client';

export const FEEDBACK_CONTEXTS = [
  'post_issuance',
  'post_claim',
  'post_renewal',
] as const;

export interface Feedback {
  id: string;
  customerId: string;
  context: string;
  score: number | null;
  comments: string | null;
  submittedAt: string;
}

export function listFeedback(
  opts: { customerId?: string; context?: string } = {},
): Promise<Feedback[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.context) params.set('context', opts.context);
  const qs = params.toString();
  return apiGet(`/feedback${qs ? `?${qs}` : ''}`);
}

export function createFeedback(body: {
  customerId: string;
  context: string;
  score?: number;
  comments?: string;
}): Promise<Feedback> {
  return apiPost('/feedback', body);
}
