import type { TranslationKey } from '../i18n/translations';
import type { LeadStatus } from './lead-api';

/**
 * The one place a `LeadStatus` becomes text a person reads.
 *
 * Typed `Record<LeadStatus, TranslationKey>` so adding a status is a compile
 * error rather than a raw token on screen. `leads/[id]` previously kept its
 * own `Record<string, string>` pair listing only four of the five statuses —
 * `DISQUALIFIED` was missing, so a disqualified lead rendered the literal
 * token, in Arabic too. Same defect the policy detail page had; see
 * lib/policy/policy-status.ts.
 */
export const LEAD_STATUS_LABEL_KEY: Record<LeadStatus, TranslationKey> = {
  NEW: 'leadStatusNew',
  CONTACTED: 'leadStatusContacted',
  QUALIFIED: 'leadStatusQualified',
  CONVERTED_TO_PROSPECT: 'leadStatusConvertedToProspect',
  DISQUALIFIED: 'leadStatusDisqualified',
};

/** Resolves a status received over the wire; `null` for anything outside the
 * union so the caller can fall back to showing it verbatim. */
export function leadStatusLabelKey(status: string): TranslationKey | null {
  return LEAD_STATUS_LABEL_KEY[status as LeadStatus] ?? null;
}
