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

/**
 * Part II §4.4 — roles that ALWAYS see the MFA prompt, trusted device or not.
 *
 * Deliberately NOT `PRIVILEGED_ROLES`, and the difference is the point.
 * `PRIVILEGED_ROLES` is a wider set used for step-up and the hardware-token
 * fast-follow; §4.4 names exactly three roles whose MFA guarantee must never be
 * softened by the trusted-device convenience. Reusing the wider list would look
 * harmless — stricter, even — but it would silently take the convenience away
 * from Executive Management and Branch/Department Managers, who the spec
 * deliberately leaves as standard roles for this purpose.
 *
 * These users never see the "trust this device" option either: §4.4 says the
 * checkbox must not even render for them, and the server refuses the grant
 * regardless of what the client sends.
 */
export const ALWAYS_MFA_ROLES: RoleName[] = [
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

/** Whether this caller must complete an MFA challenge on every single login. */
export function alwaysRequiresMfa(roles: RoleName[]): boolean {
  return roles.some((role) => ALWAYS_MFA_ROLES.includes(role));
}

/**
 * Part II §4.3 — what a login resolved to, when it did not resolve to a
 * session.
 *
 * Returned instead of tokens, so the client cannot reach anything else: the
 * onboarding wizard is uninterruptible by design, and a caller holding one of
 * these has no access token to try elsewhere.
 */
export type LoginOutcome =
  'MUST_CHANGE_PASSWORD' | 'MFA_ENROLLMENT_REQUIRED' | 'MFA_CODE_REQUIRED';
