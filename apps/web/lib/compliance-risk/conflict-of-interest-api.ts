import { apiGet, apiPost } from '../auth/api-client';

/**
 * THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER — decision 36.
 *
 * Hand-copied over HTTP and unchecked by TypeScript, like every other client in this directory: if
 * the api view gains or loses a field, this file, the component and every Playwright mock move in
 * the SAME commit. `conflict-of-interest.e2e-spec.ts` asserts these names on the response BODY.
 */
export interface ConflictOfInterestEntry {
  id: string;
  declaredByUserId: string;
  declaredByName: string;
  disclosure: string;
  declaredAt: string;
}

/** Ten characters — `DECLARATION_REASON_MIN_LENGTH`, the one home for that number, mirrored here
 * because the api reports it in its own refusal and the two are asserted equal. A screen that let
 * somebody submit below the floor would send a request it already knows will be refused. */
export const DISCLOSURE_MIN_LENGTH = 10;

export function declareConflictOfInterest(
  disclosure: string,
): Promise<ConflictOfInterestEntry> {
  return apiPost<ConflictOfInterestEntry>('/conflict-of-interest/disclosures', {
    disclosure,
  });
}

export function listConflictOfInterestDisclosures(): Promise<
  ConflictOfInterestEntry[]
> {
  return apiGet<ConflictOfInterestEntry[]>('/conflict-of-interest/disclosures');
}
