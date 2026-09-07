/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * follow-up-due predicate for the insurer non-response alert job now lives in
 * `common/follow-up.util.ts` (shared with the Claim insurer non-response
 * sweep, backlog Part C #27) — re-exported here so existing call sites and
 * tests keep importing it from the RFQ module.
 */
export { isFollowUpDue } from '../../common/follow-up.util';
