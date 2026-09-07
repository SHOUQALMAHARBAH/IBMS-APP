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
