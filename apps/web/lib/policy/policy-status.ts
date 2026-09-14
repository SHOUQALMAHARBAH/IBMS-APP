import type { TranslationKey } from '../i18n/translations';
import type { PolicyStatus } from './policy-api';

/**
 * The one place a `PolicyStatus` becomes something a person reads.
 *
 * Typed `Record<PolicyStatus, TranslationKey>` on purpose: adding a member to
 * the enum then becomes a compile error here, rather than a raw token leaking
 * onto a screen. The policy detail page previously kept its own
 * `Record<string, string>` pair, which had silently drifted — it carried
 * `PLACEMENT_REQUESTED` and `CHECKED`, neither of which is a real status, and
 * was missing `CHECKING_IN_PROGRESS`, `DISCREPANCY`, `VERIFIED` and `ACTIVE`.
 * `ACTIVE` is the state a completed policy ends in, so the most common status
 * in the system rendered as the literal word "ACTIVE", in Arabic too.
 */
export const POLICY_STATUS_LABEL_KEY: Record<PolicyStatus, TranslationKey> = {
  PLACEMENT_CONFIRMED: 'policyStatePlacementConfirmed',
  ISSUED: 'policyStateIssued',
  CHECKING_IN_PROGRESS: 'policyStateCheckingInProgress',
  DISCREPANCY: 'policyStateDiscrepancy',
  VERIFIED: 'policyStateVerified',
  DELIVERED: 'policyStateDelivered',
  ACTIVE: 'policyStateActive',
  CANCELLED: 'policyStateCancelled',
  EXPIRED: 'policyStateExpired',
};

export const POLICY_STATUS_OPTIONS = Object.keys(
  POLICY_STATUS_LABEL_KEY,
) as PolicyStatus[];

/**
 * Resolves a status this page received over the wire. Returns `null` for a
 * value outside the enum so the caller can fall back to showing it verbatim —
 * every real status is mapped above, so that path only opens if the API ever
 * sends something this build does not know about.
 */
export function policyStatusLabelKey(status: string): TranslationKey | null {
  return POLICY_STATUS_LABEL_KEY[status as PolicyStatus] ?? null;
}
