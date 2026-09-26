import { apiPost } from '../auth/api-client';

/**
 * DISCARD — one client for all four entities.
 *
 * The API deliberately exposes the same route shape and the same body on each (`POST /<collection>/:id/discard`
 * with `{ reason }`), so four copies of this would be four places for the minimum reason length to drift
 * away from the server's.
 */

/** What a read of a discardable record carries once it has been withdrawn. Null on every live record. */
export interface DiscardBlock {
  at: string;
  byUserId: string;
  reason: string;
}

/**
 * Mirrors `DISCARD_REASON_MIN_LENGTH` in `apps/api/src/common/discard.config.ts`.
 *
 * A copy, because the browser has to be able to say "too short" before a round trip. The SERVER is the
 * authority — it enforces the same floor, and a CHECK constraint per table enforces it under that — so this
 * being stale would cost a confusing 422, never a discard with no reason.
 */
export const DISCARD_REASON_MIN_LENGTH = 10;

/** The collections that accept a discard. A union rather than a string so a mistyped path cannot compile. */
export type DiscardableCollection =
  | 'policies'
  | 'claims'
  | 'endorsements'
  | 'recommendations';

export function discardRecord(
  collection: DiscardableCollection,
  id: string,
  reason: string,
): Promise<unknown> {
  return apiPost(`/${collection}/${encodeURIComponent(id)}/discard`, { reason });
}
