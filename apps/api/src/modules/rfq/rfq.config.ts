import { addBusinessDays } from '../../common/business-days.util';

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * one pure, deterministic bit of the follow-up alert job: given when an RFQ
 * was sent to an insurer and that RFQ's configurable `followUpThresholdDays`,
 * is a follow-up now due?
 *
 * The threshold is counted in **Jordan business days** (Fri/Sat weekend) via
 * `addBusinessDays()` — consistent with every other deadline in this
 * codebase (the pdpl-sla-timers registry, the KYC review SLAs). As
 * ibms-brain/meta/context/business-day-calendar.md notes, no gazetted
 * public-holiday calendar exists yet, so a computed due-date is a **lower
 * bound**: the alert may fire a day or two before the "true" business-day
 * deadline that also excludes public holidays, never after it. That is the
 * safe direction for a chase-the-insurer nudge.
 *
 * `sentAt + N business days <= now` — i.e. the whole grace window has
 * elapsed. `now` is injected rather than read here so the sweep and its
 * tests share one clock.
 */
export function isFollowUpDue(
  sentAt: Date,
  followUpThresholdDays: number,
  now: Date,
): boolean {
  if (!Number.isFinite(followUpThresholdDays) || followUpThresholdDays <= 0) {
    // A non-positive / malformed threshold would make every fresh submission
    // instantly "due" — treat it as "never auto-alert" and let a human chase
    // it, rather than flood the sweep. Should not happen: the DTO clamps the
    // caller-supplied value and the column defaults to 9.
    return false;
  }
  const dueAt = addBusinessDays(sentAt, followUpThresholdDays);
  return dueAt.getTime() <= now.getTime();
}
