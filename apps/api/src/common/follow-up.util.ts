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
 * `addBusinessDays()`.
 *
 * CORRECTED 2026-11-08, AND IT WAS WRONG TWICE. This block used to say that no
 * gazetted public-holiday calendar exists yet, citing
 * ibms-brain/meta/context/business-day-calendar.md — which said the same thing
 * and has now been corrected too. **It does exist**: `SlaHoliday` holds 48
 * rows on dev and is HTTP-editable. The claim was true when written and rotted
 * in place, in three files at once, the brain's copy being the one the other
 * two cited as their authority.
 *
 * It also called this "consistent with every other deadline in this codebase
 * (the pdpl-sla-timers registry, the KYC review SLAs)". The KYC review cadence
 * is `unit: 'months'` (`kyc.service.ts`, `REVIEW_CADENCE_MONTHS`), which never
 * consults a business-day calendar at all — so that comparison named a
 * deadline of a different kind.
 *
 * WHAT IS STILL TRUE is the consequence, which is why this is reported rather
 * than silently patched: this function takes no `BusinessDayOptions`, so its
 * due-date skips Friday/Saturday and **ignores all 48 holidays**. The computed
 * date is a **lower bound** — the alert may fire a day or two before the true
 * business-day deadline, never after it. That is the safe direction for a
 * chase-the-counterparty nudge, and it is NOT the safe direction for a
 * statutory deadline. Threading the calendar in means a signature change plus
 * a holiday read in each of its three caller modules (`claim.config.ts`,
 * `retention-case.config.ts`, `rfq.service.ts`); sized, not done.
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
