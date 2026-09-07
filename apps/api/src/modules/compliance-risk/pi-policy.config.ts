import type { Prisma } from '@ibms/db';
import { formatMoney } from '../../common/money.util';

/**
 * Process 53-54/Part 7.1 — the broker's own Professional Indemnity insurance
 * (backlog Part C #53-54's second checkbox: "Track the broker's own
 * Professional Indemnity policy (coverage limit, expiry, claims history) —
 * a broker without valid PI cover is itself a licensing breach"). The pure,
 * deterministic core: the live-lapsed check and the view/audit-snapshot
 * builders.
 *
 * `ProfessionalIndemnityPolicy` (Part 7.1 core schema) pre-existed and needs
 * no widening — `insurerName`/`coverageLimit`/`expiresAt`/
 * `claimsHistorySummary` already cover the record. **No migration, no seed
 * change** — `pi-policy.manage` (`[COMPLIANCE_OFFICER]`) was pre-seeded
 * ahead of time.
 *
 * Unlike `BrokerLicense` (Process 51), this is NOT a fixed-id singleton: the
 * model has no `issuedAt`/period-start field to define a validity window
 * with, so a renewal is a brand-new row (preserving `claimsHistorySummary`
 * history per period) rather than an in-place overwrite — the #41/#46/
 * compliance-calendar per-instance shape. "Current" is simply the row that
 * expires furthest in the future (`PiPolicyRepository.findCurrent`) — the
 * exact definition `PolicyCheckingRepository.findLatestPiPolicyId` (Process
 * 20/54's discrepancy auto-link) already relied on before this module
 * existed to give it real code.
 *
 * `ibms-brain/meta/context/operational-pi-risk.md`.
 */

/** Whether a PI policy record should be treated as lapsed **right now** —
 * purely `expiresAt < now`, since the model carries no manual-override
 * `status` field the way `BrokerLicense` does. Pure, `now` injected so the
 * view and its tests share one clock. */
export function isPiPolicyCurrentlyLapsed(
  policy: { expiresAt: Date },
  now: Date,
): boolean {
  return policy.expiresAt.getTime() <= now.getTime();
}

export interface PiPolicyRow {
  id: string;
  insurerName: string;
  coverageLimit: Prisma.Decimal;
  expiresAt: Date;
  claimsHistorySummary: string | null;
}

export interface PiPolicyView {
  id: string;
  insurerName: string;
  coverageLimit: string;
  expiresAt: string;
  claimsHistorySummary: string | null;
  /** Live-derived — see `isPiPolicyCurrentlyLapsed`. */
  isCurrentlyLapsed: boolean;
  /** Whether this is the row `PiPolicyRepository.findCurrent()` would
   * return (the furthest-out `expiresAt` on record) — computed by the
   * caller, since it requires knowing the full set, not just this row. */
  isCurrent: boolean;
}

export function derivePiPolicyView(
  row: PiPolicyRow,
  now: Date,
  currentId: string | null,
): PiPolicyView {
  return {
    id: row.id,
    insurerName: row.insurerName,
    coverageLimit: formatMoney(row.coverageLimit),
    expiresAt: row.expiresAt.toISOString(),
    claimsHistorySummary: row.claimsHistorySummary,
    isCurrentlyLapsed: isPiPolicyCurrentlyLapsed(row, now),
    isCurrent: row.id === currentId,
  };
}

/** CREATE/UPDATE audit `afterValue`. `claimsHistorySummary` is an internal
 * summary Compliance writes about the broker's own claims experience — not
 * customer data, the same `BrokerLicense.scopeOfAuthorization` reasoning —
 * included verbatim, no `NO_FULL_ACCOUNT_NUMBER` guard needed at this layer
 * (applied at the DTO layer regardless, defense in depth, since a claim
 * narrative could still mention a counterparty's account details). */
export function piPolicyAuditSnapshot(
  input: PiPolicyRow,
): Prisma.InputJsonObject {
  return {
    piPolicyId: input.id,
    insurerName: input.insurerName,
    coverageLimit: formatMoney(input.coverageLimit),
    expiresAt: input.expiresAt.toISOString(),
    claimsHistorySummary: input.claimsHistorySummary,
  };
}
