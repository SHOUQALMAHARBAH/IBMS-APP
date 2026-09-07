import { addBusinessDays } from './business-days.util';

/**
 * The one pure, deterministic bit shared by every "chase the counterparty
 * once a grace window has elapsed" job — RFQ insurer non-response (backlog
 * Part C #11/#12) and Claim insurer non-response (backlog Part C #27).
 *
 * Given when the clock started (`startedAt` — an RFQ `sentAt`, a claim's
 * `REGISTERED` `ClaimStatusHistory.changedAt`) and a configurable
 * `thresholdBusinessDays`, is a follow-up now due?
 *
 * The threshold is counted in **Jordan business days** (Fri/Sat weekend) via
 * `addBusinessDays()` — consistent with every other deadline in this codebase
 * (the pdpl-sla-timers registry, the KYC review SLAs). As
 * ibms-brain/meta/context/business-day-calendar.md notes, no gazetted
 * public-holiday calendar exists yet, so a computed due-date is a **lower
 * bound**: the alert may fire a day or two before the "true" business-day
 * deadline that also excludes public holidays, never after it. That is the
 * safe direction for a chase-the-counterparty nudge.
 *
 * `startedAt + N business days <= now` — i.e. the whole grace window has
 * elapsed. `now` is injected rather than read here so the sweep and its tests
 * share one clock.
 */
export function isFollowUpDue(
  startedAt: Date,
  thresholdBusinessDays: number,
  now: Date,
): boolean {
  if (!Number.isFinite(thresholdBusinessDays) || thresholdBusinessDays <= 0) {
    // A non-positive / malformed threshold would make every fresh record
    // instantly "due" — treat it as "never auto-alert" and let a human chase
    // it, rather than flood the sweep. Should not happen: callers clamp the
    // value and the columns default to a positive number.
    return false;
  }
  const dueAt = addBusinessDays(startedAt, thresholdBusinessDays);
  return dueAt.getTime() <= now.getTime();
}
