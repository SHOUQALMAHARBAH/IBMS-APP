import { UnprocessableEntityException } from '@nestjs/common';
import {
  DataClassification,
  DocumentCategory,
  type ClientDecisionType,
  type Prisma,
} from '@ibms/db';
import { formatMoney, subtractMoney } from '../../common/money.util';

/**
 * Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
 * B). The pure, deterministic helpers: the placement precondition, the
 * calendar-date parse, the coverage-figure shape check, the signed premium
 * variance, and the audit `afterValue` snapshots.
 *
 * `ibms-brain/meta/context/policy-lifecycle.md` § "The shapes":
 *   Placement Confirmed -> Issued (received from insurer) -> Checking In
 *   Progress -> ...
 * #18 creates the `Policy` at `PLACEMENT_CONFIRMED` from an Opportunity the
 * client has **accepted**; #19 records the insurer-issued artefacts and moves
 * it to `ISSUED` through the workflow engine.
 */

/** A Policy is placed from an Opportunity only once the client has ACCEPTed
 * the recommendation — the authoritative signal is a `ClientDecision` row
 * with this `decision` (the Opportunity status can lag a #17 best-effort
 * route). */
export const PLACEMENT_DECISION: ClientDecisionType = 'ACCEPT';

export const DOCUMENT_CATEGORIES = Object.values(DocumentCategory);
export const DATA_CLASSIFICATIONS = Object.values(DataClassification);

/**
 * Parses a client-supplied policy date (inception / expiry / schedule
 * effective-from) into a `Date`. Unlike `parseHistoricalInstant`, a policy
 * date MAY be in the future (cover can incept next month), so there is no
 * not-future check — but the same server-local-time trap applies: a datetime
 * with no offset (`2026-10-01T00:00:00`) is parsed as server-local and
 * silently shifts the instant, so a time component MUST carry an explicit
 * offset. A bare date (`2026-10-01`, parsed as UTC midnight) is the expected
 * form and is unambiguous.
 */
export function parseCalendarDate(raw: string, label: string): Date {
  const hasTimeComponent = /\d{2}:\d{2}/.test(raw);
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (hasTimeComponent && !hasOffset) {
    throw new UnprocessableEntityException(
      `${label} must be a plain date (e.g. "2026-10-01") or carry an explicit timezone offset`,
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityException(`${label} is not a valid date`);
  }
  return parsed;
}

/**
 * A `PolicySchedule.limits` / `.sumsInsured` blob — the requested/issued
 * coverage snapshot (Part 3.4). Stored opaquely as JSON (no arithmetic is
 * done on it here — same treatment as `Quotation.limits` at #13/#14); the
 * only check is that it is a non-empty flat object of scalar values, so a
 * bare array / string / `{}` can't be persisted as a "schedule". Per-figure
 * `Decimal(18,3)` precision on these amounts is deferred to the first
 * consumer that does arithmetic on them (a Claim resolving "coverage in
 * force at the loss date", Part 3.7).
 */
export function assertCoverageFigures(
  value: unknown,
  label: string,
): Prisma.InputJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnprocessableEntityException(`${label} must be a JSON object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    throw new UnprocessableEntityException(
      `${label} must have at least one entry`,
    );
  }
  for (const [key, v] of entries) {
    if (
      v === null ||
      (typeof v !== 'string' && typeof v !== 'number') ||
      (typeof v === 'number' && !Number.isFinite(v))
    ) {
      throw new UnprocessableEntityException(
        `${label}.${key} must be a string or a finite number`,
      );
    }
  }
  return value;
}

/** The signed issued-minus-requested premium delta, fils-quantized through
 * `money.util.ts` — a negative value means the insurer issued cheaper than
 * quoted. `null` until the policy is issued. A `Policy` has one `currency`
 * column shared by both amounts, so there is no cross-currency case. */
export function premiumVariance(
  requestedPremium: Prisma.Decimal,
  issuedPremium: Prisma.Decimal | null,
): string | null {
  if (issuedPremium === null) return null;
  // subtractMoney quantizes and preserves sign.
  return subtractMoney(issuedPremium, requestedPremium).toFixed(3);
}

/** CREATE audit `afterValue` for a placed policy — metadata + the money as a
 * fixed string, never anything free-text. */
export function policyPlacementAuditSnapshot(row: {
  opportunityId: string;
  customerId: string;
  insurerId: string;
  insuranceLine: string;
  status: string;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  requestedPremium: Prisma.Decimal;
  currency: string;
  placedByUserId: string | null;
}): Prisma.InputJsonObject {
  return {
    opportunityId: row.opportunityId,
    customerId: row.customerId,
    insurerId: row.insurerId,
    insuranceLine: row.insuranceLine,
    status: row.status,
    inceptionDate: row.inceptionDate ? row.inceptionDate.toISOString() : null,
    expiryDate: row.expiryDate ? row.expiryDate.toISOString() : null,
    requestedPremium: formatMoney(row.requestedPremium),
    currency: row.currency,
    placedByUserId: row.placedByUserId,
  };
}

/** UPDATE audit `afterValue` for the #19 issuance step. The workflow engine
 * writes the TRANSITION row (before/after `status`) separately; this records
 * the issued *values* it does not capture. Money as a fixed string; no
 * schedule figures, no document filenames. */
export function policyIssuanceAuditSnapshot(row: {
  policyNumber: string;
  issuedPremium: Prisma.Decimal;
  issuedByUserId: string;
  scheduleEffectiveFrom: Date;
  documentCount: number;
}): Prisma.InputJsonObject {
  return {
    policyNumber: row.policyNumber,
    issuedPremium: formatMoney(row.issuedPremium),
    issuedByUserId: row.issuedByUserId,
    scheduleEffectiveFrom: row.scheduleEffectiveFrom.toISOString(),
    documentCount: row.documentCount,
  };
}

/** CREATE audit `afterValue` for a `PolicySchedule` — the effective date and
 * the *shape* of the coverage snapshot (key names + counts), never the
 * figures themselves (they can be commercially sensitive; "metadata not
 * body", same as #12/#13/#15/#16). */
export function policyScheduleAuditSnapshot(row: {
  policyId: string;
  effectiveFrom: Date;
  limits: Prisma.JsonValue;
  sumsInsured: Prisma.JsonValue;
  namedPerils: string[];
  extensions: string[];
}): Prisma.InputJsonObject {
  const keysOf = (v: Prisma.JsonValue): string[] =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v)
      : [];
  return {
    policyId: row.policyId,
    effectiveFrom: row.effectiveFrom.toISOString(),
    limitKeys: keysOf(row.limits),
    sumsInsuredKeys: keysOf(row.sumsInsured),
    namedPerilCount: row.namedPerils.length,
    extensionCount: row.extensions.length,
  };
}

/** CREATE audit `afterValue` for a `Document` attached to a policy file. The
 * `fileName` can carry a person's name (a health certificate naming insured
 * persons — HIGHLY_CONFIDENTIAL) and `storageRef` is an internal object key,
 * so both are excluded — only category / classification / version /
 * provenance (ibms-brain/meta/lex/sensitive-data-handling.md). */
export function policyDocumentAuditSnapshot(row: {
  id: string;
  policyId: string | null;
  category: string;
  classification: string;
  versionNumber: number;
  uploadedByUserId: string;
}): Prisma.InputJsonObject {
  return {
    documentId: row.id,
    policyId: row.policyId,
    category: row.category,
    classification: row.classification,
    versionNumber: row.versionNumber,
    uploadedByUserId: row.uploadedByUserId,
  };
}
