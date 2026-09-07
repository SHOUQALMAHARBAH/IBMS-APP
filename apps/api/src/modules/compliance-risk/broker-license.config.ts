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
 * A well-known, fixed id — "the broker's own CBJ license status" (the
 * model's own doc comment) is singular by nature: a broker holds exactly one
 * current license at a time, unlike per-customer/per-policy rows. Rather
 * than a migration adding a partial-unique/singleton constraint for a
 * resource Compliance creates once and then only ever updates (an
 * infrequent, deliberate, human action — not a concurrent-write hotspot,
 * the same "app-level is enough" reasoning M03's exactly-one-owner check
 * used), the row is simply always created under this id; `findCurrent`
 * looks it up directly rather than a `findFirst` guess.
 */
export const BROKER_LICENSE_SINGLETON_ID = 'the-broker-license';

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

export interface BrokerLicenseRow {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: Date | null;
  expiresAt: Date;
  status: string;
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
  };
}
