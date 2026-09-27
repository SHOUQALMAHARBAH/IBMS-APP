import { apiGet, apiPatch, apiPost } from '../auth/api-client';

/**
 * The managed insurance-line vocabulary — the standard 32 plus this office's own additions.
 *
 * `code` is NULL for an office addition, and that absence IS the distinction: a code is a
 * platform-wide identifier and an office cannot mint one, because two offices inventing `PET` for
 * different things would make the code meaningless. `isStandard` says the same thing explicitly.
 */
export interface InsuranceLine {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  category: 'GENERAL' | 'LIFE';
  isStandard: boolean;
}

/**
 * Every line this office can pick from, standard lines first in market order.
 *
 * Gated on `insurer.read` server-side. A caller without it gets a 403, which every consumer here
 * should treat as "render no picker" rather than as an error worth showing — the permission gap is
 * an administrator's problem, not the user's.
 */
export function listInsuranceLines(): Promise<InsuranceLine[]> {
  return apiGet('/insurance-lines');
}

/*
 * ADDING TO, AND CORRECTING, THE VOCABULARY — `POST /insurance-lines` and
 * `PATCH /insurance-lines/:id`.
 *
 * NEITHER HAD A WEB CALLER, and the first was invisible to IMPROVEMENTS § 1.44's
 * original measurement because that pass compares PATHS: `GET /insurance-lines` is
 * called for the pickers, so the POST on the same path read as covered. The
 * verb-aware second pass found it (§ 1.65). So an office could pick from the
 * vocabulary and could neither extend nor correct it — which for a broker means a
 * line of business it actually writes has no entry, and every screen that groups by
 * line has nowhere to put that business.
 *
 * BOTH NAMES ARE REQUIRED ON AN ADDITION, and that is not symmetry for its own sake:
 * Arabic is this platform's primary language, a line name appears on documents a
 * client reads, and an entry that exists in one script only renders untranslated
 * mid-sentence on the other language's page.
 *
 * THERE IS NO `code` FIELD, deliberately and permanently. A code is a platform-wide
 * identifier and an office cannot mint one — two offices inventing `PET` for
 * different things would make every report that groups by code wrong. `code: null`
 * IS the marker of an office addition, which is why `isStandard` and a null code say
 * the same thing.
 */

export interface AddInsuranceLineInput {
  nameEn: string;
  nameAr: string;
  category: 'GENERAL' | 'LIFE';
}

export function addInsuranceLine(
  input: AddInsuranceLineInput,
): Promise<InsuranceLine> {
  return apiPost('/insurance-lines', {
    nameEn: input.nameEn.trim(),
    nameAr: input.nameAr.trim(),
    category: input.category,
  });
}

/** Corrects one of THIS OFFICE'S OWN additions. A standard line's id reads as absent
 * server-side — not forbidden — because it is not an office addition; the screen
 * therefore offers the control only where `isStandard` is false. Every field is
 * optional, so only what changed is sent. */
export function updateInsuranceLine(
  id: string,
  input: Partial<AddInsuranceLineInput>,
): Promise<InsuranceLine> {
  const body: Record<string, string> = {};
  if (input.nameEn?.trim()) body.nameEn = input.nameEn.trim();
  if (input.nameAr?.trim()) body.nameAr = input.nameAr.trim();
  if (input.category) body.category = input.category;
  return apiPatch(`/insurance-lines/${encodeURIComponent(id)}`, body);
}

/** The DTO's floor on both names. Mirrored so the button disables rather than the
 * server refusing after a round trip; the server stays the authority. */
export const LINE_NAME_MIN_LENGTH = 2;

export function lineNamesAreValid(input: {
  nameEn: string;
  nameAr: string;
}): boolean {
  return (
    input.nameEn.trim().length >= LINE_NAME_MIN_LENGTH &&
    input.nameAr.trim().length >= LINE_NAME_MIN_LENGTH
  );
}

/** A correction has to change SOMETHING — an empty body is a no-op server-side, and a
 * screen should not send a request that does nothing. */
export function lineEditHasChanges(
  input: Partial<AddInsuranceLineInput>,
  original: InsuranceLine,
): boolean {
  const en = input.nameEn?.trim();
  const ar = input.nameAr?.trim();
  return (
    (!!en && en !== original.nameEn) ||
    (!!ar && ar !== original.nameAr) ||
    (!!input.category && input.category !== original.category)
  );
}
