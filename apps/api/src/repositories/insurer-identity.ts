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
  // Whether the office still deals with this insurer.
  //
  // ## This reverses an earlier decision in this feature, deliberately
  //
  // The commit that enforced deactivation kept `isActive` OUT of here, arguing it
  // is not part of an insurer's IDENTITY and that pushing a placement-time concern
  // into eighteen consumers was wrong. That argument does not survive the decision
  // to keep CAPTURING a quotation from a deactivated insurer legal: such a quote
  // reaches the comparison matrix, and a broker could present it and a client could
  // choose it, with nobody discovering the problem until placement refused. Silently
  // comparable is a worse failure than not recorded.
  //
  // So the comparison and the recommendation genuinely need it, and the choice is
  // between adding it here or adding a second insurer-reading definition. This file
  // exists because five private copies of that join once drifted, so one definition
  // wins. A consumer that has no use for the flag (a certificate of insurance, a
  // policy schedule) simply does not render it — selecting a field is not the same
  // as showing it.
  isActive: true,
} as const satisfies Prisma.InsurerSelect;

/** The shape `INSURER_IDENTITY_SELECT` returns. */
export interface InsurerIdentity {
  id: string;
  financialStrengthRating: string | null;
  /** NULL for an office-local insurer — see this file's header. */
  insurerMaster: { legalName: string; legalNameAr: string | null } | null;
  legalName: string | null;
  legalNameAr: string | null;
  isActive: boolean;
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
  /** FALSE when the office has stopped dealing with this insurer. Every surface
   *  that lets someone CHOOSE an insurer has to show this — see the select. */
  isActive: boolean;
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
    isActive: insurer.isActive,
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

/* ==============================================================================================
 * MODULE 0-ب ITEM (e), DECISION 63 — THE COMPANY-FACT RESOLVER.
 *
 * ## THE PRECEDENCE, STATED ONCE IN PROSE AND ONCE IN CODE
 *
 *    1. THE REGISTERED COMPANY  — `Insurer.insuranceCompany`, an `Organization` of type
 *                                 `INSURANCE_COMPANY` that registered itself on this platform.
 *                                 Most authoritative: it is the company's own record of itself,
 *                                 entered against its own licence.
 *    2. THE GLOBAL CATALOGUE    — `InsurerMaster`. NAMES ONLY; it carries no contact facts.
 *    3. THE OFFICE'S OWN ROW    — the local `Insurer` columns. What this office typed, and the only
 *                                 answer for a company that has not registered — which is the
 *                                 MAJORITY case, measured: 4 of dev's 19 rows and 6 of db-test's 534
 *                                 were local-only when decision 63 was written.
 *
 * ## WHY THIS LIVES IN THIS FILE AND NOT A NEW ONE
 *
 * This file already owns the master-over-local precedence for the NAME. A second file owning the
 * registered-over-master precedence would be two homes for one question — "where does an insurer's
 * name come from" — and the two would answer differently the first time one of them learned about a
 * source the other had not. One file, one precedence, three levels.
 *
 * ## THE SOURCE IS CHOSEN ONCE, THEN EVERY FIELD IS READ FROM IT
 *
 * The same rule `insurerIdentity` already follows, and for the same reason a unit test caught there:
 * per-field `??` looks equivalent and is not. A registered company with no Arabic name would fall
 * through to the OFFICE'S Arabic name, rendering the company's own Latin name beside a name the
 * office typed — the two-sources-of-truth drift the precedence exists to prevent.
 *
 * So a null here means "this source does not publish that fact", never "ask the next source". The
 * office's own values are not lost: they stay in the local columns, the screen shows them as what
 * THIS OFFICE RECORDED, and `source` below is what lets it say so.
 * ============================================================================================== */

/** Which of the three sources answered. The screen LABELS this — an office looking at a company fact
 *  has to be able to tell what it typed itself from what the company published. */
export type InsurerCompanyFactSource =
  'REGISTERED_COMPANY' | 'GLOBAL_CATALOGUE' | 'OFFICE_LOCAL';

/** What the resolver needs. A superset of `InsurerIdentity`, because the name precedence gains a
 *  third level and the contact facts gain a second. */
export interface InsurerCompanyFactSources {
  insurerMaster: { legalName: string; legalNameAr: string | null } | null;
  insuranceCompany: {
    legalName: string;
    legalNameAr: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
  } | null;
  legalName: string | null;
  legalNameAr: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyCorrespondenceAddress: string | null;
}

export interface ResolvedInsurerCompanyFacts {
  source: InsurerCompanyFactSource;
  name: string;
  nameAr: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  correspondenceAddress: string | null;
}

/**
 * THE ONLY PLACE A COMPANY FACT IS RESOLVED. `deriveInsurerView` calls this and nothing else reads
 * the local `company*` columns to decide what to show.
 *
 * `name` stays NON-nullable, the property every consumer was already written against, and it is safe
 * for the same reason `insurerIdentity`'s is: `Insurer_has_identity` refuses a row with neither a
 * master link nor a local name. The `?? ''` is unreachable and exists only because TypeScript cannot
 * see a CHECK.
 */
export function resolveInsurerCompanyFacts(
  insurer: InsurerCompanyFactSources,
): ResolvedInsurerCompanyFacts {
  if (insurer.insuranceCompany) {
    const company = insurer.insuranceCompany;
    return {
      source: 'REGISTERED_COMPANY',
      name: company.legalName,
      nameAr: company.legalNameAr,
      phone: company.phone,
      email: company.email,
      website: company.website,
      correspondenceAddress: company.address,
    };
  }

  if (insurer.insurerMaster) {
    /*
     * THE CATALOGUE ANSWERS FOR THE NAME AND FOR NOTHING ELSE, and the contact fields below fall to
     * the office's own row rather than to null. That is NOT a per-field coalesce in disguise: the
     * catalogue has no phone, email, website or address columns at all, so there is no second
     * SOURCE for those facts to drift from — the office's row is the only one that has ever held
     * them for a master-linked insurer, and it has held them since long before this item.
     *
     * The source label reports GLOBAL_CATALOGUE because that is where the NAME came from, which is
     * the fact an office can be misled about. Reporting OFFICE_LOCAL here would tell a reader the
     * office named the company, which it did not.
     */
    return {
      source: 'GLOBAL_CATALOGUE',
      name: insurer.insurerMaster.legalName,
      nameAr: insurer.insurerMaster.legalNameAr,
      phone: insurer.companyPhone,
      email: insurer.companyEmail,
      website: insurer.companyWebsite,
      correspondenceAddress: insurer.companyCorrespondenceAddress,
    };
  }

  return {
    source: 'OFFICE_LOCAL',
    name: insurer.legalName ?? '',
    nameAr: insurer.legalNameAr,
    phone: insurer.companyPhone,
    email: insurer.companyEmail,
    website: insurer.companyWebsite,
    correspondenceAddress: insurer.companyCorrespondenceAddress,
  };
}

/** Whether this office may still EDIT the local company columns.
 *
 *  FALSE once the record is linked: the registered company answers for those facts, and letting an
 *  office keep typing over them would recreate the second source of truth the link exists to remove.
 *  The columns are not cleared and not dropped — they stay as what the office recorded before the
 *  link, which is why the screen can still show them, labelled. */
export function officeMayEditCompanyFacts(insurer: {
  insuranceCompanyId: string | null;
}): boolean {
  return insurer.insuranceCompanyId === null;
}
