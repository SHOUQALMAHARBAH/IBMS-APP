import type { Prisma } from '@ibms/db';

/**
 * Part I §5 (multi-tenancy Phase 3) — how every read gets an insurer's name.
 *
 * The identity of a real insurance company lives on the GLOBAL `InsurerMaster`;
 * `Insurer` is one office's relationship with it and no longer carries a name
 * at all. So a caller that wants to display "AIG Jordan" has to join, and this
 * is the one definition of that join.
 *
 * It exists as a single shared constant because there were previously FIVE
 * near-identical private copies (comparison, policy, quotation, recommendation,
 * rfq). When the shape changed under them, a stale `name: true` did not fail
 * the build — Prisma's `Exact` resolves an unknown key in a `select` to
 * `never`, so the copies silently typed `insurer.name` as `never` and only
 * surfaced further downstream, if at all. One definition means one place to get
 * this right.
 */
export const INSURER_IDENTITY_SELECT = {
  id: true,
  financialStrengthRating: true,
  insurerMaster: { select: { legalName: true, legalNameAr: true } },
} as const satisfies Prisma.InsurerSelect;

/** The shape `INSURER_IDENTITY_SELECT` returns. */
export interface InsurerIdentity {
  id: string;
  financialStrengthRating: string | null;
  insurerMaster: { legalName: string; legalNameAr: string | null };
}

/**
 * Flattens the join back to the `{ id, name, nameAr }` shape the API has always
 * returned, so the wire format is unchanged by the split — the insurer's name
 * is still the insurer's name to every consumer, it just no longer lives on the
 * office's own row.
 */
export function insurerIdentity(insurer: InsurerIdentity): {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
} {
  return {
    id: insurer.id,
    name: insurer.insurerMaster.legalName,
    nameAr: insurer.insurerMaster.legalNameAr,
    financialStrengthRating: insurer.financialStrengthRating,
  };
}

/** The name alone — the common case for a report row or a document line. */
export function insurerName(insurer: {
  insurerMaster: { legalName: string };
}): string {
  return insurer.insurerMaster.legalName;
}
