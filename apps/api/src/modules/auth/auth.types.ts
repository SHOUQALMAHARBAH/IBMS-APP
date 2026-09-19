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
  /**
   * The ids of this caller's active roles — the ONLY thing authorization may
   * resolve permissions from.
   *
   * Office-scoped custom roles made `Role.name` non-unique across offices, so
   * a name can no longer identify a role: two offices may each have a
   * "Manager", with different grants. Ids are uuids and unique everywhere, so
   * `PermissionsService.getCodesForRoles(roleIds)` cannot cross a tenant
   * boundary. See `PermissionRepository.findCodesForRoles`.
   */
  roleIds: string[];
  /**
   * The NAMES of the same roles, in the same order — display and diagnostics
   * only.
   *
   * Still plain strings rather than an enum because an office names its own
   * roles. Code that reads this to make an authorization decision is a Phase 2
   * conversion target: it will not recognise any custom role, so it fails
   * closed at best and open at worst (see `ALWAYS_MFA_ROLES`). New code must
   * branch on a PERMISSION, never on a name.
   */
  roles: string[];
  sessionId: string;
}

/**
 * ⚠️ PHASE 2 CONVERSION TARGET — THIS LIST FAILS OPEN FOR A CUSTOM ROLE.
 *
 * Both this and `ALWAYS_MFA_ROLES` below match on role NAME. An office-defined
 * role appears in neither list, so it silently qualifies for the exemption the
 * list exists to deny — a security control weakened by a configuration screen.
 *
 * The approved fix is NOT a permission (an administrator could grant it away)
 * but a Role-level flag — `requiresMfaAlways` / `requiresHardwareToken` —
 * defaulting to the SAFE value for every new role, so a custom role fails
 * closed. Phase 2, proven by test #19.
 *
 * Not yet exploitable: no custom role can exist until the Role CRUD screen
 * lands in Phase 3, and every role migrated in Phase 1 kept its legacy name,
 * so these lists still match exactly who they matched before. Phase 2 must
 * land before Phase 3 for that to stay true.
 */
export const PRIVILEGED_ROLES: readonly string[] = [
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'EXECUTIVE_MANAGEMENT',
  'BRANCH_DEPARTMENT_MANAGER',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

/** Part 10.1 — privileged roles + Compliance/DPO require a hardware-token
 * MFA factor once WebAuthn ships (fast-follow — see auth module README).
 * See the fail-open warning on `PRIVILEGED_ROLES`. */
export function requiresHardwareToken(roles: readonly string[]): boolean {
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
export const ALWAYS_MFA_ROLES: readonly string[] = [
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

/** Whether this caller must complete an MFA challenge on every single login.
 * ⚠️ Fails open for a custom role — see the warning on `PRIVILEGED_ROLES`. */
export function alwaysRequiresMfa(roles: readonly string[]): boolean {
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
