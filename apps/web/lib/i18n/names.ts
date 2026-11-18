import type { Language } from './translations';

/**
 * 🔴 A NAME THAT EXISTS IN BOTH SCRIPTS IS PRINTED IN THE READER'S — ONE PLACE THAT DECIDES.
 *
 * ## Why this file exists, measured on the owner's demo-path walk of 2026-11-17 (§P4)
 *
 * The Arabic names were already there and the screens were printing the English ones. The API
 * sends `{ name, nameAr }` for every insurer — `INSURER_IDENTITY_SELECT` selects `legalNameAr`
 * and `insurerIdentity()` resolves the pair — `/insurers` and `/insurer-directory` rendered the
 * Arabic, and the RFQ, quotation, comparison, recommendation and policy blocks rendered the
 * English. Same data, two answers, on one screen in one language.
 *
 * ⟶ So this is NOT new behaviour. It is the behaviour three screens already had, made the
 *   behaviour all of them have, with one function instead of fifteen hand-written ternaries.
 *
 * ## ⛔ No Arabic is written here, and none can be
 *
 * Every string this returns came out of the database. There is no dictionary key, no fallback
 * phrase and no transliteration: an insurer with no Arabic name renders its Latin one, because
 * inventing an Arabic name for a real company is exactly the thing decision 125 forbids and this
 * file is not where that would be noticed.
 *
 * ## The fallback direction is deliberate and it is one-way
 *
 * Arabic missing -> show the Latin name. English requested -> show the Latin name, never the
 * Arabic one. A reader who has chosen English and is shown Arabic has been handed a string they
 * may not be able to read; a reader who has chosen Arabic and is shown a Latin company name has
 * been handed the name on that company's own licence. Those are not symmetric.
 */

/** The pair every insurer arrives with. `nameAr` is optional so a narrower row still fits. */
export interface BilingualName {
  name: string;
  nameAr?: string | null;
}

/**
 * The insurer's name in the reader's language.
 *
 * ⚠️ `nameAr` is checked for CONTENT, not merely for presence. A whitespace-only Arabic name is
 * a blank cell on screen, which is the silent failure shape this repository keeps meeting — an
 * empty string renders as nothing and nobody is told.
 */
export function insurerDisplayName(
  insurer: BilingualName,
  language: Language,
): string {
  if (language === 'AR') {
    const ar = insurer.nameAr?.trim();
    if (ar) return ar;
  }
  return insurer.name;
}

/** The same question for a row that carries its names as `nameEn` / `nameAr`, which is how the
 *  insurance-line catalogue and the other provider reference tables are shaped. */
export interface BilingualReferenceName {
  nameEn: string;
  nameAr?: string | null;
}

export function referenceDisplayName(
  row: BilingualReferenceName,
  language: Language,
): string {
  if (language === 'AR') {
    const ar = row.nameAr?.trim();
    if (ar) return ar;
  }
  return row.nameEn;
}

/**
 * THE INSURANCE LINE, in the reader's language.
 *
 * ⚠️ `insuranceLineAr` COMES FROM THE SERVER AND IS NEVER LOOKED UP HERE. The 32-row catalogue
 * that holds the Arabic names is behind `GET /insurance-lines`, which is gated on five
 * permissions — and `policy.read` is not one of them, so `CLAIMS_OFFICER` and
 * `POLICY_CHECKING_OFFICER` may read a policy and could not resolve its line name. Measured
 * 2026-11-17; ⛔ the answer was not to widen that gate or grant anybody a code.
 *
 * `null` means no Arabic name is known for that row, and the English string it stored is shown.
 * ⛔ That is not a cue to invent one.
 */
export interface BilingualLineName {
  insuranceLine: string;
  insuranceLineAr?: string | null;
}

export function lineDisplayName(
  row: BilingualLineName,
  language: Language,
): string {
  if (language === 'AR') {
    const ar = row.insuranceLineAr?.trim();
    if (ar) return ar;
  }
  return row.insuranceLine;
}

/** And for a row that has not been through `insurerIdentity()` — the global `InsurerMaster`
 *  catalogue, which the «register an insurer» picker reads directly and which carries its names
 *  under their database column names. Same rule, same one-way fallback. */
export interface BilingualLegalName {
  legalName: string;
  legalNameAr?: string | null;
}

export function legalDisplayName(
  row: BilingualLegalName,
  language: Language,
): string {
  if (language === 'AR') {
    const ar = row.legalNameAr?.trim();
    if (ar) return ar;
  }
  return row.legalName;
}
