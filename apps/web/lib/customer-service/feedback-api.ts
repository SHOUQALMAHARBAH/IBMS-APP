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
  /**
   * RULE 2 — WHO THE ROW IS ABOUT, resolved by the api. This column used to render the first
   * eight characters of a uuid, which identifies nobody.
   *
   * Hand-copied over HTTP where TypeScript cannot check it against the api's own view, which
   * is how the customer-import result panel broke — so it is asserted on the response body in
   * an api e2e, not only in a Playwright mock that supplies it itself.
   */
  customerName: string;
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
