import { apiPost } from '../auth/api-client';

/*
 * Stopping and restarting one SLA clock — `POST /sla/timers/:id/pause` and
 * `/resume`, both behind `sla.timer.pause`.
 *
 * WHY THIS FILE DID NOT EXIST
 * ---------------------------
 * Both routes shipped with no web caller at all (IMPROVEMENTS § 1.44), so the
 * permission `sla.timer.pause` could be granted and exercised by nobody, and
 * the only way to stop a statutory clock was to construct the request by hand.
 * Pausing a compliance deadline is close to the definition of an act that must
 * be visible and audited, which is why these rank next after the refund
 * disbursement among the unreachable routes.
 *
 * AND WHY CLOSING IT NEEDED THE DASHBOARD FIXED FIRST
 * --------------------------------------------------
 * `classifyTimer` compared against raw `dueAt`, so a paused timer reported
 * BREACHED on the SLA dashboard, was counted as a breach in `breachRate`, and
 * was charged overdue days for the whole pause. That had never produced a wrong
 * figure for one reason: nothing could pause. Shipping this button without that
 * fix would have introduced the false breach rather than found it.
 */

/** The floor `PauseSlaTimerDto` enforces. Duplicated here deliberately and for
 * one purpose: a screen must not send a request it already knows will 422. The
 * server remains the authority. */
export const SLA_PAUSE_REASON_MIN_LENGTH = 10;

export function slaPauseReasonIsValid(reason: string): boolean {
  return reason.trim().length >= SLA_PAUSE_REASON_MIN_LENGTH;
}

export interface SlaTimerPauseResult {
  id: string;
  pausedAt: string | null;
  pausedTotalMs: number;
}

/** Stops the clock. `reason` is mandatory server-side — a stopped compliance
 * clock with no stated basis is indistinguishable from one somebody forgot to
 * restart. Sent TRIMMED, so the ten characters the server counts are the ten
 * the reader typed. */
export function pauseSlaTimer(
  timerId: string,
  reason: string,
): Promise<SlaTimerPauseResult> {
  return apiPost(`/sla/timers/${timerId}/pause`, { reason: reason.trim() });
}

/** Restarts it, banking the elapsed pause. No reason: the basis was recorded
 * when it stopped, and the service refuses a resume on a timer that is not
 * paused rather than treating it as a no-op. */
export function resumeSlaTimer(timerId: string): Promise<SlaTimerPauseResult> {
  return apiPost(`/sla/timers/${timerId}/resume`, {});
}
