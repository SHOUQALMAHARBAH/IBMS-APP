/**
 * MODULE 0-ب, DECISION 88 — THE REGISTRATION PACK'S COMPLETENESS, DERIVED.
 *
 * Field 50 of the broker sheet, and it is NOT a column. Computed from the documents actually
 * present, exactly as licence status is computed (decision 71). A stored flag drifts from the thing
 * it claims to summarise, which is the seed-drift defect class this project has caught twice — and
 * the migration refuses a completeness column by name so it cannot come back.
 *
 * ## THE CLAUSE THAT MATTERS MOST, AND IT IS A CONSTRAINT ON WORDING
 *
 * THE MARKER STATES WHAT **WE** HOLD. NEVER A FINDING ABOUT THE OFFICE.
 *
 * It is forbidden for this marker — or any label, tooltip, report column or export built on it — to
 * say or imply that the office fails art. 10/a, or that it is in breach, or that it is
 * non-compliant.
 *
 * The reason is not delicacy. An office licensed by the Central Bank DID submit these documents to
 * the regulator: that is what being licensed means. Our database not holding a copy is OUR gap, not
 * its violation. A marker worded the other way is the system making a FALSE REGULATORY FINDING
 * against a compliant office — exactly the defect caught when the provider itself appeared in the
 * office-state view as an office with no licence term.
 *
 * `REGISTRATION_PACK_FORBIDDEN_WORDS` below is that clause made testable, and a test asserts the
 * VISIBLE text against it.
 *
 * ## IT NAMES, IT DOES NOT COUNT
 *
 * "missing: lease contract or title deed", never "2 documents missing". Standing verification rule 2:
 * where a count stands in for a named set, the count asserts the wrong thing — and here it also tells
 * the reader nothing they can act on, because the two documents come from different places and
 * different people.
 *
 * ## IT GATES NOTHING
 *
 * Not sign-in, not role creation, not quotation requests, not anything. A marker and a report. If it
 * is ever to have an effect that is a new decision, and this file is where somebody would look for
 * permission to build one — so: there is none.
 */

/** The two art. 10/a documents, in the order the article lists them. */
export const REGISTRATION_PACK_DOCUMENTS = [
  {
    key: 'premisesTenure' as const,
    /** Art. 10/a/2 — «نسخة عن عقد الإيجار أو سند الملكية للمقر الخاص به». */
    article: 'art. 10/a/2',
  },
  {
    key: 'associationMembership' as const,
    /** Art. 10/a/3 — «ما يثبت انتساب ... إلى الجمعية الأردنية لوسطاء التأمين»; art. 18/a repeats it
     *  in the periodic returns, so it recurs annually. */
    article: 'art. 10/a/3',
  },
] as const;

export type RegistrationPackDocumentKey =
  (typeof REGISTRATION_PACK_DOCUMENTS)[number]['key'];

/**
 * WORDS THE MARKER MAY NEVER CARRY, in either language.
 *
 * Not a style guide — the clause above, in the only form that can fail a build. A screen, a report
 * column or an export that builds on `missing` and reaches for one of these is making a regulatory
 * finding this system has no basis for.
 */
export const REGISTRATION_PACK_FORBIDDEN_WORDS = [
  'breach',
  'non-compliant',
  'noncompliant',
  'non-compliance',
  'violation',
  'violates',
  'infringe',
  'fails art',
  'in default',
  'مخالف',
  'مخالفة',
  'إخلال',
  'عدم التزام',
  'غير ملتزم',
  'انتهاك',
] as const;

export interface RegistrationPackSources {
  premisesTenureDocumentId: string | null;
  associationMembershipDocumentId: string | null;
}

export interface RegistrationPackState {
  /** The documents this system does NOT hold, BY NAME. Empty when it holds both. */
  missing: RegistrationPackDocumentKey[];
  /** True when nothing is missing. Derived from `missing` rather than stored beside it, so the two
   *  cannot disagree. */
  complete: boolean;
}

/**
 * WHAT WE HOLD, computed. Never what the office has or has not done.
 *
 * The order is the article's, not insertion order or alphabetical, so a reader comparing the marker
 * against art. 10/a reads them in the same sequence.
 */
export function deriveRegistrationPackState(
  sources: RegistrationPackSources,
): RegistrationPackState {
  const held: Record<RegistrationPackDocumentKey, boolean> = {
    premisesTenure: sources.premisesTenureDocumentId !== null,
    associationMembership: sources.associationMembershipDocumentId !== null,
  };
  const missing = REGISTRATION_PACK_DOCUMENTS.filter((d) => !held[d.key]).map(
    (d) => d.key,
  );
  return { missing, complete: missing.length === 0 };
}
