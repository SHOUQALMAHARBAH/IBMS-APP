/**
 * Part F item #4 — Jordanian national-ID-convention name splitting (given
 * name + father's name + grandfather's name + family name, the four parts
 * printed on a Jordanian national ID card). `Customer` (individual only),
 * `Employee`, and `UltimateBeneficialOwner` each keep their existing flat
 * name column (`legalName`/`fullName`) as a computed/denormalized display
 * string, so every existing consumer (Arabic sorting, `<bdi>` display,
 * search, audit logs, exports) keeps working unchanged — this is the one
 * place that computes it, used identically by all three services instead of
 * three copies of the same join.
 */
export interface PersonNameParts {
  givenName: string;
  fatherName?: string;
  grandfatherName?: string;
  familyName: string;
}

/** Joins the present parts with a single space, trimmed. `fatherName`/
 * `grandfatherName` are optional — not every record has both on file. */
export function composeFullName(parts: PersonNameParts): string {
  return [
    parts.givenName,
    parts.fatherName,
    parts.grandfatherName,
    parts.familyName,
  ]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
}

/**
 * `composeFullName` for a name set that may be entirely absent.
 *
 * Returns `undefined` rather than `''` when no part was given, so a caller writes NULL instead of an
 * empty string. The distinction is not cosmetic: an empty string is a name somebody entered and left
 * blank, NULL is "this person has no English name recorded" — and on this platform the second is the
 * ordinary case, since transliterating an Arabic name is a judgement the system must not make.
 */
export function composeOptionalFullName(
  parts: Partial<PersonNameParts>,
): string | undefined {
  // `Partial`, and NOT by widening `composeFullName` — the Arabic set has a required given and
  // family name and the compiler should keep insisting on them for every caller that has them.
  // The empty strings below are filtered out by the same filter that drops an absent father's name.
  const composed = composeFullName({
    ...parts,
    givenName: parts.givenName ?? '',
    familyName: parts.familyName ?? '',
  });
  return composed.length > 0 ? composed : undefined;
}
