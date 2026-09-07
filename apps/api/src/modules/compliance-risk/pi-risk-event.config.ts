import type { Prisma } from '@ibms/db';

/**
 * Process 54 — exposures from advice/placement errors (backlog Part C
 * #53-54's shared header: "`ProfessionalIndemnityRiskEvent`"). The pure,
 * deterministic core: the view/audit-snapshot builders.
 *
 * `ProfessionalIndemnityRiskEvent` (Part 7.1 core schema) already had a real
 * writer before this module: `PolicyCheckingRepository.recordChecking`
 * (Process 20) auto-logs one, in the SAME `$transaction` as the
 * `PolicyChecking` row, the moment a coverage discrepancy is found —
 * see that repository's own comment. This module gives the resulting rows
 * their first read/list surface and a manual log path for an exposure that
 * did not come through a Policy Checking discrepancy (e.g. a placement
 * error the officer caught themselves before it reached that stage).
 *
 * `ibms-brain/meta/context/operational-pi-risk.md`.
 */

export interface PiRiskEventRow {
  id: string;
  piPolicyId: string | null;
  sourcePolicyCheckingId: string | null;
  description: string;
  mitigationAction: string | null;
  loggedAt: Date;
}

export interface PiRiskEventView {
  id: string;
  piPolicyId: string | null;
  sourcePolicyCheckingId: string | null;
  description: string;
  mitigationAction: string | null;
  loggedAt: string;
  /** Whether this event came from the automatic Policy Checking discrepancy
   * link (Process 20) rather than a manual log — derived, not a stored
   * field. */
  isAutoLogged: boolean;
}

export function derivePiRiskEventView(row: PiRiskEventRow): PiRiskEventView {
  return {
    id: row.id,
    piPolicyId: row.piPolicyId,
    sourcePolicyCheckingId: row.sourcePolicyCheckingId,
    description: row.description,
    mitigationAction: row.mitigationAction,
    loggedAt: row.loggedAt.toISOString(),
    isAutoLogged: row.sourcePolicyCheckingId !== null,
  };
}

/** CREATE/UPDATE audit `afterValue`.
 *
 * For a MANUAL entry (`sourcePolicyCheckingId === null`), `description` is
 * an internal exposure narrative Compliance/Placement wrote themselves — not
 * a customer's own free text, the `BrokerLicense.scopeOfAuthorization`
 * reasoning — included verbatim; the `NO_FULL_ACCOUNT_NUMBER` guard is still
 * applied at the DTO layer, defense in depth, since a placement-error
 * narrative could still name a counterparty's account details.
 *
 * For an AUTO-LOGGED entry (`sourcePolicyCheckingId` set), `description` is
 * built by `piRiskEventDescription()` (`policy-checking.config.ts`), which
 * embeds the exact coverage-figure diff (limits/sumsInsured amounts) plus
 * the policy number — a `@code-reviewer` MAJOR on the first pass: this is
 * the SAME content `policyCheckingAuditSnapshot` deliberately keeps OUT of
 * the audit trail on the sibling `PolicyChecking` row
 * (ibms-brain/meta/lex/sensitive-data-handling.md — "metadata not body"),
 * and this module was about to re-embed it one field over merely because it
 * now lives under a different name. Redacted to a placeholder here instead —
 * the coverage figures are already recorded, once, on the `PolicyChecking`
 * row's own audit-excluded `discrepancyDetail`; this audit trail only needs
 * to prove a risk event existed and was reviewed. */
export function piRiskEventAuditSnapshot(
  input: PiRiskEventRow,
): Prisma.InputJsonObject {
  const isAutoLogged = input.sourcePolicyCheckingId !== null;
  return {
    piRiskEventId: input.id,
    piPolicyId: input.piPolicyId,
    sourcePolicyCheckingId: input.sourcePolicyCheckingId,
    description: isAutoLogged
      ? '[redacted — auto-logged from a Policy Checking discrepancy; see PolicyChecking.discrepancyDetail, itself excluded from the audit trail]'
      : input.description,
    mitigationAction: input.mitigationAction,
    loggedAt: input.loggedAt.toISOString(),
  };
}
