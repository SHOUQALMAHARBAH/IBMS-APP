import { apiGet, apiPatch, ApiError } from '../auth/api-client';

/**
 * MODULE 0-ب — the data protection officer designation, and the acknowledgement when one person
 * holds both it and the office-manager assignment.
 *
 * ## THESE INTERFACES ARE HAND-COPIED OVER HTTP AND TYPESCRIPT CANNOT CHECK THEM
 *
 * The recorded rule for this directory: when the api view shape changes, this file, the screen and
 * every Playwright mock change in the SAME commit, or the import-panel defect ships again — a field
 * replaced server-side reads as `undefined` here and throws during render, with nothing failing at
 * compile time. `dpo-designation.e2e-spec.ts` asserts these field names on the response BODY for
 * exactly that reason.
 */
export interface DpoDesignationView {
  dataProtectionOfficerName: string | null;
  generalManagerName: string | null;
  combinedWithManager: boolean;
  declarationRequired: boolean;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedByName: string | null;
  noticeShown: string | null;
}

export const DPO_MANAGER_COMBINED_DECLARATION_REQUIRED =
  'DPO_MANAGER_COMBINED_DECLARATION_REQUIRED';

/**
 * True when the save was refused because the acknowledgement was missing — NOT because the
 * arrangement is disallowed, which nothing here refuses.
 *
 * Read off the `code` field rather than guessed from the status, the `isMfaEnrolmentError`
 * precedent: a 422 that a screen guesses at is a screen that tells the reader the wrong thing about
 * half the time, and the API has always said which is which.
 *
 * It is the SECOND of two paths that reveal the notice. The first is the screen's own optimistic
 * comparison, which catches the ordinary case — somebody typing the manager's name as it is written
 * on the row. This one catches the case the screen deliberately cannot: two spellings of one name
 * that the server's canonical fold treats as the same person. The screen holds no copy of that fold,
 * because a second copy of "are these the same person" is a second answer to it.
 */
export function isCombinedDeclarationRequired(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 422 &&
    err.code === DPO_MANAGER_COMBINED_DECLARATION_REQUIRED
  );
}

export function getDpoDesignation(): Promise<DpoDesignationView> {
  return apiGet<DpoDesignationView>('/duty-segregation/dpo-designation');
}

export function recordDpoDesignation(input: {
  dataProtectionOfficerName: string;
  /** Sent only when the office is acknowledging; omitted entirely otherwise. */
  declaration?: { noticeShown: string; acknowledged: true };
}): Promise<DpoDesignationView> {
  return apiPatch<DpoDesignationView>('/duty-segregation/dpo-designation', {
    dataProtectionOfficerName: input.dataProtectionOfficerName,
    ...(input.declaration
      ? { combinedAssignmentDeclaration: input.declaration }
      : {}),
  });
}
