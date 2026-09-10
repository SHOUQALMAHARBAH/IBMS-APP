import { RoleName } from '@ibms/db';

/**
 * The roles that hold the CHECKER half of a maker/checker pair.
 *
 * Derived directly from `ibms-brain/meta/lex/maker-checker-segregation.md`'s
 * own table — one entry per row that names a role this system actually seeds:
 *
 *   | Maker                                  | Checker                         |
 *   |----------------------------------------|---------------------------------|
 *   | Officer who places a policy            | POLICY_CHECKING_OFFICER         |
 *   | Officer who captures KYC data          | COMPLIANCE_OFFICER              |
 *   | Officer who raises a refund/write-off  | FINANCE_COLLECTIONS_OFFICER     |
 *   | Manager who nominates a disposal batch | DATA_PROTECTION_OFFICER         |
 *   | Employee who requests a data share     | DATA_PROTECTION_OFFICER         |
 *   | Owner who assesses a third party       | DATA_PROTECTION_OFFICER         |
 *   | DPO officer who processes a DSR        | DATA_PROTECTION_OFFICER (other) |
 *   | DPO who classifies an incident Material| EXECUTIVE_MANAGEMENT            |
 *
 * BRANCH_DEPARTMENT_MANAGER is included as the nominating/approving half of
 * the Part 3.1 dual-control deletion pair.
 *
 * ## Why this list exists — the control it is a detective for
 *
 * `assertDifferentActors` enforces maker ≠ checker on ONE identity. It cannot
 * see that one human holds two identities. A `user.manage` holder can
 * provision a second account carrying the other half of any pair above and
 * then work both sides single-handed, with no dual control and nothing in the
 * system that looks unusual.
 *
 * That is not a gap in the lex — the lex is explicit that "admin consoles and
 * back-office override tools" are NOT exempt from maker/checker. It is a gap
 * in what the system can SEE.
 *
 * This module deliberately does NOT block the grant. Blocking would invent a
 * dual-control policy for provisioning that the business has not agreed to,
 * and would be the wrong call to make unilaterally on a regulated control.
 * What it does instead is make the grant impossible to make quietly: a
 * distinct, queryable audit row plus a log line Compliance can alert on. A
 * detective control is a real control; a silent one is not.
 */
export const CHECKER_ROLES: readonly RoleName[] = [
  RoleName.POLICY_CHECKING_OFFICER,
  RoleName.COMPLIANCE_OFFICER,
  RoleName.FINANCE_COLLECTIONS_OFFICER,
  RoleName.DATA_PROTECTION_OFFICER,
  RoleName.EXECUTIVE_MANAGEMENT,
  RoleName.BRANCH_DEPARTMENT_MANAGER,
];

export function isCheckerRole(role: RoleName): boolean {
  return CHECKER_ROLES.includes(role);
}

/** Every checker role in `roles`, in the catalogue's order so the result is
 * stable regardless of the order they were requested in. */
export function checkerRolesIn(roles: readonly RoleName[]): RoleName[] {
  const requested = new Set(roles);
  return CHECKER_ROLES.filter((role) => requested.has(role));
}

/** What the segregation-relevant audit row and log line say happened. */
export interface SegregationSignal {
  checkerRoles: RoleName[];
  /** The administrator granted a checker role to THEMSELVES. Distinguished
   * because it is the shape that needs no second account at all, and is the
   * strongest single indicator of privilege escalation on this surface. */
  selfGrant: boolean;
}

export function segregationSignal(input: {
  roles: readonly RoleName[];
  subjectUserId: string;
  actorUserId: string;
}): SegregationSignal | null {
  const checkerRoles = checkerRolesIn(input.roles);
  if (checkerRoles.length === 0) return null;
  return {
    checkerRoles,
    selfGrant: input.subjectUserId === input.actorUserId,
  };
}
