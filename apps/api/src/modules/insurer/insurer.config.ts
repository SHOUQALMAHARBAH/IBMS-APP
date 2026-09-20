import { insurerIdentity } from '../../repositories/insurer-identity';
import type { InsurerRecord } from '../../repositories/insurer.repository';

/**
 * Insurer management — the pure half: what a registration body means, and what an
 * insurer record looks like on the wire.
 *
 * Kept out of the service so each rule can be tested without a database. The two
 * that matter are the identity XOR (which registration path is this?) and the
 * collision classification (WHICH uniqueness did the database refuse?), because
 * both produce a message a person has to act on.
 */

/** One of the office's own insurer records, as every caller sees it. */
export interface InsurerView {
  id: string;
  /** Resolved through `insurerIdentity` — the catalogue's name when this row links
   *  to one, the office's own otherwise. Never null; see that file. */
  name: string;
  nameAr: string | null;
  /** TRUE when this office registered the company itself, so its name is the
   *  office's to correct. FALSE for a row linked to the global catalogue, whose
   *  name is not editable here. The screen needs this to decide whether the name
   *  fields are writable at all. */
  isOfficeLocal: boolean;
  /** NULL for an office-local registration. Exposed because it is the identity of
   *  a PUBLIC company record, not a fact about any office. */
  insurerMasterId: string | null;
  isActive: boolean;
  linesOffered: string[];
  financialStrengthRating: string | null;
  creditTermsDays: number | null;
  rfqContactName: string | null;
  rfqContactEmail: string | null;
  rfqContactPhone: string | null;
  claimsContactName: string | null;
  claimsContactEmail: string | null;
  underwriterContact: string | null;
  createdAt: Date;
}

export function deriveInsurerView(row: InsurerRecord): InsurerView {
  const identity = insurerIdentity(row);
  return {
    id: identity.id,
    name: identity.name,
    nameAr: identity.nameAr,
    // Derived from the LINK, not from whether a name happens to be present: a row
    // may carry both (the database does not stop it), and which one is
    // authoritative is decided by the link in exactly one place.
    isOfficeLocal: row.insurerMasterId === null,
    insurerMasterId: row.insurerMasterId,
    isActive: identity.isActive,
    linesOffered: row.linesOffered,
    financialStrengthRating: identity.financialStrengthRating,
    creditTermsDays: row.creditTermsDays,
    rfqContactName: row.rfqContactName,
    rfqContactEmail: row.rfqContactEmail,
    rfqContactPhone: row.rfqContactPhone,
    claimsContactName: row.claimsContactName,
    claimsContactEmail: row.claimsContactEmail,
    underwriterContact: row.underwriterContact,
    createdAt: row.createdAt,
  };
}

/** Which of the two registration paths a body asked for. */
export type IdentityPath =
  | { path: 'MASTER'; insurerMasterId: string }
  | { path: 'LOCAL'; legalName: string; legalNameAr: string }
  | { error: string };

/**
 * Decides the registration path, or says why the body does not describe one.
 *
 * ONE endpoint serves both paths rather than two, because "register an insurer" is
 * one act to whoever is doing it — whether the company already appears in the
 * shared catalogue is an implementation fact about our data, not a decision the
 * administrator should have to make by choosing a URL.
 *
 * Both scripts are required for a local registration, for the same reason Phase 1
 * made them required on `Role`: Arabic is this system's primary language, and a
 * company whose name exists only in Latin script renders untranslated mid-sentence
 * on an Arabic page. A catalogue link needs neither, because the catalogue carries
 * the names.
 */
export function resolveIdentityPath(input: {
  insurerMasterId?: string;
  legalName?: string;
  legalNameAr?: string;
}): IdentityPath {
  const hasLocalName =
    input.legalName !== undefined || input.legalNameAr !== undefined;

  if (input.insurerMasterId !== undefined) {
    if (hasLocalName) {
      return {
        error:
          'Provide either insurerMasterId or a legal name, not both. A company already in the shared catalogue takes its name from there, and a second copy here would be a competing source of truth for one fact.',
      };
    }
    return { path: 'MASTER', insurerMasterId: input.insurerMasterId };
  }

  if (!hasLocalName) {
    return {
      error:
        'Provide insurerMasterId for a company already in the shared catalogue, or legalName and legalNameAr to register one that is not.',
    };
  }
  if (input.legalName === undefined || input.legalNameAr === undefined) {
    return {
      error:
        'Both legalName and legalNameAr are required when registering a company that is not in the shared catalogue — this system renders insurer names in Arabic as well as Latin script.',
    };
  }
  return {
    path: 'LOCAL',
    legalName: input.legalName,
    legalNameAr: input.legalNameAr,
  };
}

/** Which of the two office-scoped uniqueness rules a registration ran into.
 *  Decided by the WRITE PATH rather than read out of the Prisma error, which
 *  carries no usable constraint name here — see `InsurerService.asCollision`. */
export type CollisionKind = 'LOCAL_NAME' | 'MASTER_LINK';

/**
 * What to tell somebody who hit one.
 *
 * Both constraints are scoped to the ORGANIZATION, which is what makes it safe to
 * say "already registered" at all: the answer is derived entirely from the caller's
 * own office, so the message cannot become an oracle for what other offices deal
 * with. That is the same reason `Insurer.insurerMasterId` is nullable in the first
 * place rather than auto-creating a platform-unique master row — see the schema
 * comment.
 */
export function collisionMessage(kind: CollisionKind, name: string): string {
  return kind === 'LOCAL_NAME'
    ? `This office already registers an insurer named "${name}". It may have been deactivated — reactivate that record rather than registering a second one, so its policies, claims and invoices all stay against one insurer.`
    : 'This office already has a relationship with that company. Open the existing record rather than registering a second one — an office holds one set of commercial terms per insurer.';
}

/** Every field a caller can patch on an insurer holds one of these, so the audit
 *  delta is a flat scalar map — which is also what `AuditLogEntry.beforeValue`
 *  accepts without a cast. */
type AuditScalar = string | number | boolean | null;

/**
 * What an UPDATE actually changed, for the audit row.
 *
 * Only the keys the caller sent AND whose value genuinely differs: a PATCH that
 * resends a field unchanged should not produce an audit row claiming it was
 * edited, and the audit trail is read by people reconstructing who altered a
 * commercial term.
 *
 * Values are recorded in full rather than redacted. Nothing on an insurer
 * relationship is Highly Confidential under Part 10.2 (that list is medical data,
 * financial account details, national identity numbers and UBO records) — these are
 * an insurer's business contacts and the credit terms this office negotiated, which
 * are Confidential, and the audit log is itself behind `audit-log.read`. Redacting
 * them would leave a trail that records that a credit term moved without recording
 * what it moved from, which is the one thing the trail exists to answer.
 */
export function auditDelta(
  row: object,
  patch: object,
): {
  changed: string[];
  before: Record<string, AuditScalar>;
  after: Record<string, AuditScalar>;
} {
  const current = row as Record<string, AuditScalar | undefined>;
  const changed: string[] = [];
  const before: Record<string, AuditScalar> = {};
  const after: Record<string, AuditScalar> = {};
  for (const [key, next] of Object.entries(patch) as [
    string,
    AuditScalar | undefined,
  ][]) {
    if (next === undefined) continue;
    if (current[key] === next) continue;
    changed.push(key);
    before[key] = current[key] ?? null;
    after[key] = next;
  }
  return { changed, before, after };
}
