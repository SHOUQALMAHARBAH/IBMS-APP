import type { TranslationKey } from '../i18n/translations';
import type { OpportunityStatus } from './opportunity-api';

/**
 * The ten opportunity stages, each with its label key. ONE map, because two screens now render
 * it — the same promotion `lib/lead/lead-status.ts` and `lib/policy/policy-status.ts` already
 * made for their own enums, and for the same reason.
 *
 * It lived privately inside `components/client-decision/ClientDecisionSection.tsx` while that
 * section was the only place a stage was shown as words. **The KPI dashboard shows it too** —
 * `/kpi-dashboard`'s sales card prints `opportunitiesByStatus`, and it printed the raw token
 * (`RECOMMENDATION_DRAFTED`) at a reader, in Arabic as well as English. Decision 153 §C1/§M1
 * is that sighting.
 *
 * ⛔ PROMOTED, NEVER COPIED. A second map is how two screens come to disagree about what a
 * stage is called — the drift `repositories/insurer-identity.ts` records the cost of, where
 * five private copies of one join silently diverged.
 *
 * A TOTAL `Record`, not a loose lookup: adding an eleventh status without a label is then a
 * TYPE ERROR rather than a raw enum word rendered at a reader in whichever language the
 * database speaks.
 */
export const OPPORTUNITY_STATUS_LABEL_KEY: Record<
  OpportunityStatus,
  TranslationKey
> = {
  NEEDS_CONFIRMED: 'oppStatusNeedsConfirmed',
  RFQ_ISSUED: 'oppStatusRfqIssued',
  QUOTES_RECEIVED: 'oppStatusQuotesReceived',
  COMPARISON_BUILT: 'oppStatusComparisonBuilt',
  RECOMMENDATION_DRAFTED: 'oppStatusRecommendationDrafted',
  SENT_TO_CLIENT: 'oppStatusSentToClient',
  CLIENT_DECISION: 'oppStatusClientDecision',
  PLACEMENT: 'oppStatusPlacement',
  RENEGOTIATE: 'oppStatusRenegotiate',
  CLOSED_LOST: 'oppStatusClosedLost',
};
