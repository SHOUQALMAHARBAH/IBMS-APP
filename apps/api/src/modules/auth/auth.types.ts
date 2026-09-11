import type { RoleName } from '@ibms/db';

/** What `JwtStrategy.validate` resolves and attaches to `req.user`. */
export interface AuthenticatedUser {
  id: string;
  /** Multi-tenancy Phase 2 (spec §4.10.2) — the Organization every query made
   * on this caller's behalf is scoped to. Sourced from `User.organizationId`,
   * which `SessionService.validateAndTouch` already loads, so it costs no
   * extra query. Phase 4 additionally puts it in the JWT itself and checks it
   * against the subdomain-resolved org on every request. */
  organizationId: string;
  email: string;
  roles: RoleName[];
  sessionId: string;
}

export const PRIVILEGED_ROLES: RoleName[] = [
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'EXECUTIVE_MANAGEMENT',
  'BRANCH_DEPARTMENT_MANAGER',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

/** Part 10.1 — privileged roles + Compliance/DPO require a hardware-token
 * MFA factor once WebAuthn ships (fast-follow — see auth module README). */
export function requiresHardwareToken(roles: RoleName[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role));
}
