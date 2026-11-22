/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * follow-up-due predicate for the insurer non-response alert job now lives in
 * `common/follow-up.util.ts` (shared with the Claim insurer non-response
 * sweep, backlog Part C #27) — re-exported here so existing call sites and
 * tests keep importing it from the RFQ module.
 */
export { isFollowUpDue } from '../../common/follow-up.util';

/**
 * The stable code on the 422 raised when an RFQ is asked for on an opportunity that is not open
 * for one.
 *
 * OWNER DECISION 157 ruling 1. Decision 153 §٢ row ١٦ ratified a sentence naming the PLACEMENT
 * stage — «لأنها في مرحلة التنسيب» — but this server refuses in EVERY status other than
 * `NEEDS_CONFIRMED` and `RFQ_ISSUED`, so a closed-lost opportunity was told it was in placement.
 * Six of the eight statuses the sentence could be shown for made it false. Her ruling keeps the
 * sentence and lets the status name itself.
 *
 * ⚠️ A CODE rather than a parsed message. The screen that raises an RFQ holds only the
 * opportunity's ID — it reads `?opportunityId=` out of the query string and never fetches the
 * record — so it cannot know the status unless the refusal says so. Matching on the English
 * prose would make the sentence a wire format: a reword would silently stop the Arabic
 * rendering and fall back to showing the server's English.
 */
export const OPPORTUNITY_NOT_OPEN_FOR_RFQ = 'OPPORTUNITY_NOT_OPEN_FOR_RFQ';
