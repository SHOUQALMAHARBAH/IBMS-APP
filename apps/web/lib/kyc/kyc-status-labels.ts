import type { KycStatus } from './kyc-api';
import type { TranslationKey } from '../i18n/translations';

/**
 * The eight KYC stages, each with its label key. ONE map, because two screens now render it.
 *
 * It lived inside `KycQueue.tsx` while the queue was the only screen that showed a stage. The customer
 * detail page now shows it too — `docs/kyc-path.md` defect 1: the stage was invisible on the one screen
 * a person opens, so a Sales officer submitting a file for review landed on a page that said nothing
 * about what had just happened, and a customer could sit in PENDING_KYC with nobody able to see why.
 *
 * A TOTAL `Record`, not a loose lookup. Adding a ninth status without a label is then a TYPE ERROR
 * rather than a raw enum word rendered at a reader in whichever language the database speaks — the
 * failure IMPROVEMENTS § 1.45 records, where a loose map compiled fine and printed `paused` on screen.
 */
export const KYC_STATUS_LABEL_KEY: Record<KycStatus, TranslationKey> = {
  DRAFT: 'kycStatusDraft',
  SUBMITTED: 'kycStatusSubmitted',
  SCREENING: 'kycStatusScreening',
  EDD: 'kycStatusEdd',
  COMPLIANCE_REVIEW: 'kycStatusComplianceReview',
  APPROVED: 'kycStatusApproved',
  REJECTED: 'kycStatusRejected',
  PERIODIC_REVIEW_DUE: 'kycStatusPeriodicReviewDue',
};

/**
 * Which stages mean "a human still has to do something".
 *
 * Mirrors `NotificationRepository.countKycRecordsAwaitingDecision`'s `where` on the api side, and the
 * two must agree: a customer page saying a file is awaiting a decision while the bell does not count it
 * is a disagreement a reader cannot resolve. `DRAFT` is excluded because the capturing officer has not
 * finished; `PERIODIC_REVIEW_DUE` because it is a re-review on its own cadence rather than onboarding.
 */
export const KYC_AWAITING_DECISION: readonly KycStatus[] = [
  'SUBMITTED',
  'SCREENING',
  'EDD',
  'COMPLIANCE_REVIEW',
];
