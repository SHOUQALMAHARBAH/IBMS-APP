import type { Prisma } from '@ibms/db';

/**
 * Part I §5 (multi-tenancy Phase 3) — how every read gets an insurer's name.
 *
 * The identity of a real insurance company lives on the GLOBAL `InsurerMaster`;
 * `Insurer` is one office's relationship with it. So a caller that wants to
 * display "AIG Jordan" has to join, and this is the one definition of that join.
 *
 * It exists as a single shared constant because there were previously FIVE
 * near-identical private copies (comparison, policy, quotation, recommendation,
 * rfq). When the shape changed under them, a stale `name: true` did not fail
 * the build — Prisma's `Exact` resolves an unknown key in a `select` to
 * `never`, so the copies silently typed `insurer.name` as `never` and only
 * surfaced further downstream, if at all. One definition means one place to get
 * this right.
 *
 * ## Insurer management — the master link is now OPTIONAL
 *
 * An office can register a company that is in no global catalogue, so
 * `insurerMasterId` is nullable and such a row carries its own `legalName` /
 * `legalNameAr`. Every name read therefore coalesces, and this file is the only
 * place that decision is made.
 *
 * **Master first, local second.** When a row HAS a master link, the global
 * catalogue is the authority on the company's name — a local override would be a
 * second source of truth for one fact, and the two would drift. The local fields
 * are populated only for rows with no link (the `Insurer_has_identity` CHECK
 * refuses a row with neither), which is why the fallback can be total rather than
 * defensive.
 *
 * Widening this interface is what made the change safe: `insurerMaster` became
 * nullable, so TypeScript walked all 18 importers and 15 call sites had to be
 * looked at. None of them could silently read a name that is now nullable.
 */
export const INSURER_IDENTITY_SELECT = {
  id: true,
  financialStrengthRating: true,
  insurerMaster: { select: { legalName: true, legalNameAr: true } },
  // The office-local identity, for a company with no global row. Always
  // selected: a consumer cannot know which kind of row it is about to render,
  // and the coalesce below needs both halves present.
  legalName: true,
  legalNameAr: true,
} as const satisfies Prisma.InsurerSelect;

/** The shape `INSURER_IDENTITY_SELECT` returns. */
export interface InsurerIdentity {
  id: string;
  financialStrengthRating: string | null;
  /** NULL for an office-local insurer — see this file's header. */
  insurerMaster: { legalName: string; legalNameAr: string | null } | null;
  legalName: string | null;
  legalNameAr: string | null;
}

/** Just the two name sources, for the callers that only need a name. Kept as its
 *  own type so `insurerName()` can accept a partial row without demanding the
 *  whole identity select. */
export interface InsurerNameSources {
  insurerMaster: { legalName: string } | null;
  legalName: string | null;
}

/**
 * Flattens the join back to the `{ id, name, nameAr }` shape the API has always
 * returned, so the wire format is unchanged by either split — the insurer's name
 * is still the insurer's name to every consumer, whether it lives on the global
 * catalogue row or on the office's own.
 *
 * `name` stays NON-nullable, which is the property every consumer was already
 * written against. That is safe because of the database, not because of a
 * fallback string: `Insurer_has_identity` refuses a row with neither a master
 * link nor a local name, so one of the two is always present. The `?? ''` is
 * unreachable and exists only because TypeScript cannot see the CHECK — if it
 * ever fires, a nameless row got in and the empty string is the least misleading
 * thing to render while that is investigated.
 */
export function insurerIdentity(insurer: InsurerIdentity): {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
} {
  // The SOURCE is chosen once, then both names are read from it — not coalesced
  // field by field.
  //
  // Per-field `??` looked equivalent and was not: a master-linked row whose
  // master has no Arabic name would fall through to the LOCAL Arabic name,
  // rendering the master's Latin name beside the office's own Arabic one. That is
  // precisely the two-sources-of-truth drift the master-first order exists to
  // prevent, and a unit test caught it rather than a reviewer.
  const source = insurer.insurerMaster
    ? {
        name: insurer.insurerMaster.legalName,
        nameAr: insurer.insurerMaster.legalNameAr,
      }
    : { name: insurer.legalName ?? '', nameAr: insurer.legalNameAr };

  return {
    id: insurer.id,
    name: source.name,
    nameAr: source.nameAr,
    financialStrengthRating: insurer.financialStrengthRating,
  };
}

/** The name alone — the common case for a report row or a document line. */
export function insurerName(insurer: InsurerNameSources): string {
  // Same source-first rule as `insurerIdentity`. Only one field here, so the
  // fall-through bug that one had is not reachable — written this way anyway, so
  // the two cannot diverge if a second name field is ever added.
  return insurer.insurerMaster
    ? insurer.insurerMaster.legalName
    : (insurer.legalName ?? '');
}
