import type { Prisma } from '@ibms/db';

/**
 * Process 51/Part 7.1 — the broker's own CBJ regulatory license (backlog
 * Part C #51's first checkbox: "Automatically block new business issuance
 * once the license lapses"). The pure, deterministic core: the status
 * domain, the live-lapsed check shared by the gate and the view, and the
 * audit snapshot.
 *
 * `BrokerLicense` (Part 7.1 core schema) pre-existed and needs no widening —
 * `licenseNumber`/`scopeOfAuthorization`/`issuedAt`/`expiresAt`/`status`
 * already cover the record. **No migration, no seed change** —
 * `license.manage` (`[COMPLIANCE_OFFICER]`) was pre-seeded ahead of time.
 *
 * `ibms-brain/meta/context/regulatory-compliance.md`.
 */

export const BROKER_LICENSE_STATUSES = ['active', 'lapsed'] as const;
export type BrokerLicenseStatus = (typeof BROKER_LICENSE_STATUSES)[number];

/**
 * THE SINGLETON IS GONE — Module 0 item (c). Kept as a note rather than silently deleted, because
 * the shape it created is worth not reinventing.
 *
 * `BROKER_LICENSE_SINGLETON_ID = 'the-broker-license'` was used as the PRIMARY KEY, on the
 * reasoning that "a broker holds exactly one current license at a time". The reasoning was about
 * ONE office; the column is global. So there could be at most one licence row in the whole
 * database: the second office to call `create` collided on `BrokerLicense_pkey` and could never
 * hold a licence, while its `findCurrent()` returned NULL and the new-business gate read that as
 * "not blocked".
 *
 * A term is now a row, keyed by uuid and scoped by `organizationId` like everything else.
 */

/**
 * Whether the license should be treated as lapsed **right now** — an
 * explicit manual `status: 'lapsed'` (e.g. a CBJ suspension ahead of the
 * calendar expiry) OR the calendar expiry having already passed, whichever
 * fires first. Pure, `now` injected so the gate and the view share one
 * clock with their tests.
 *
 * Deliberately does **not** rely solely on the stored `status` column being
 * kept fresh by a background sweep — the #16 `@code-reviewer` MAJOR lesson
 * ("a control that fires only when a human/sweep configured data in the
 * right order first is procedural, not structural") applies directly here:
 * `PolicyService.place()`'s block must be correct the INSTANT `expiresAt`
 * passes, not only after some future scheduled sweep has had a chance to
 * run and flip the column. There is therefore no `BrokerLicenseSweepScheduler`
 * in this codebase at all — the live check below is both the gate's
 * decision and the read view's derived flag, so there is nothing for a
 * sweep to keep in sync.
 */
export function isBrokerLicenseCurrentlyLapsed(
  license: { status: string; expiresAt: Date },
  now: Date,
): boolean {
  return (
    license.status === 'lapsed' || license.expiresAt.getTime() <= now.getTime()
  );
}

/** ONE TERM as stored. */
export interface BrokerLicenseRow {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: Date | null;
  expiresAt: Date;
  status: string;
  /** Mandatory — see the model. A term with no certificate is unrepresentable. */
  certificateDocumentId: string;
  /** When the renewal application for the NEXT term was filed, or null. Item (d) reads this. */
  renewalRequestedAt: Date | null;
}

/**
 * THE OFFICE'S CURRENT TERM — the one with the latest expiry.
 *
 * Latest expiry rather than "the one covering today", because those differ exactly when it matters:
 * between filing a renewal (due 45 days before expiry, art. 11) and the old term running out, an
 * office legitimately holds TWO terms, and the one that decides whether it may practise tomorrow is
 * the newer one. Picking "the term covering today" would answer with the outgoing term and report
 * an office as lapsing when it has already been renewed.
 *
 * Returns null for an office with no terms at all. That is NOT the same as "not blocked" — see
 * `PolicyService.assertLicenseNotLapsed`, where absence blocks.
 */
export function pickCurrentTerm<T extends { expiresAt: Date }>(
  terms: readonly T[],
): T | null {
  let current: T | null = null;
  for (const t of terms) {
    if (!current || t.expiresAt.getTime() > current.expiresAt.getTime()) {
      current = t;
    }
  }
  return current;
}

export interface BrokerLicenseView {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: string | null;
  expiresAt: string;
  status: string;
  /** Live-derived — see `isBrokerLicenseCurrentlyLapsed`. May be `true` even
   * when `status` still reads `"active"`, if nothing has renewed/marked it
   * since `expiresAt` passed. */
  isCurrentlyLapsed: boolean;
  certificateDocumentId: string;
  renewalRequestedAt: string | null;
}

export function deriveBrokerLicenseView(
  row: BrokerLicenseRow,
  now: Date,
): BrokerLicenseView {
  return {
    id: row.id,
    licenseNumber: row.licenseNumber,
    scopeOfAuthorization: row.scopeOfAuthorization,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    isCurrentlyLapsed: isBrokerLicenseCurrentlyLapsed(row, now),
    certificateDocumentId: row.certificateDocumentId,
    renewalRequestedAt: row.renewalRequestedAt
      ? row.renewalRequestedAt.toISOString()
      : null,
  };
}

/** CREATE/UPDATE audit `afterValue` — no free text beyond
 * `scopeOfAuthorization`, an internal regulatory-scope label Compliance
 * writes about the broker's own authorization (not customer data, not a
 * field a customer could paste anything into) — included verbatim, unlike
 * the `NO_FULL_ACCOUNT_NUMBER`-guarded customer-facing free-text fields
 * elsewhere in this codebase. */
export function brokerLicenseAuditSnapshot(
  input: BrokerLicenseRow,
): Prisma.InputJsonObject {
  return {
    brokerLicenseId: input.id,
    licenseNumber: input.licenseNumber,
    scopeOfAuthorization: input.scopeOfAuthorization,
    issuedAt: input.issuedAt ? input.issuedAt.toISOString() : null,
    expiresAt: input.expiresAt.toISOString(),
    status: input.status,
    certificateDocumentId: input.certificateDocumentId,
    renewalRequestedAt: input.renewalRequestedAt
      ? input.renewalRequestedAt.toISOString()
      : null,
  };
}
