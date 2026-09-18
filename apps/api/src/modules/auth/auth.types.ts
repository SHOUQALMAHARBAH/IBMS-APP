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
   * closed. (The two that failed OPEN were the MFA controls, and they are gone
   * — see `RoleSecurityAttributes` below.) New code must branch on a
   * PERMISSION, never on a name.
   */
  roles: string[];
  sessionId: string;
}

/**
 * The two MFA obligations a role can carry, resolved for one caller.
 *
 * ## What this replaced, and why it is not a permission
 *
 * Until Phase 2 these were two hard-coded lists of role NAMES —
 * `ALWAYS_MFA_ROLES` (Part II §4.4) and `PRIVILEGED_ROLES` (Part 10.1). Once an
 * office can define its own role, a name-keyed list matches nothing it did not
 * already know, so a custom role appeared in neither and silently qualified for
 * the exemption the list existed to deny. These were the only two controls in
 * this codebase that failed OPEN.
 *
 * The replacement is a column on `Role`, not a permission. A permission can be
 * revoked from the Role screen, which would mean the control could be switched
 * off from the very UI this project is adding. `Role.requiresMfaAlways` and
 * `Role.requiresHardwareToken` default to the STRICT value, so a role nobody
 * classified is strict until someone relaxes it deliberately — it fails closed.
 *
 * ## Why the two flags stay separate
 *
 * Part 10.1's set is WIDER than §4.4's, and the difference is load-bearing:
 * Executive Management and Branch/Department Manager are flagged for the
 * WebAuthn hardware-token requirement while keeping the trusted-device
 * convenience §4.4 deliberately leaves them. Deriving one flag from the other
 * would look stricter and would quietly take that convenience from both.
 */
export interface RoleSecurityAttributes {
  /** §4.4 — this caller sees the MFA prompt on every login, trusted device or
   *  not, and the "trust this device" option is neither offered nor honoured. */
  requiresMfaAlways: boolean;
  /** Part 10.1 — this caller must present a hardware-token factor once
   *  WebAuthn ships (fast-follow — see the auth module README). Surfaced as
   *  `mfaPolicySatisfied`; it has never blocked a login. */
  requiresHardwareToken: boolean;
}

/**
 * Resolves one caller's obligations from the roles they hold.
 *
 * ANY role carrying an obligation imposes it: holding one strict role and one
 * relaxed role is strict. The alternative — requiring every role to agree —
 * would let an administrator weaken a privileged account by granting it an
 * extra, ordinary role, which is the opposite of what these controls are for.
 *
 * Structurally typed rather than taking `RoleRef`, so this module keeps no
 * dependency on the repository layer.
 */
export function roleSecurityAttributes(
  roles: readonly RoleSecurityAttributes[],
): RoleSecurityAttributes {
  return {
    requiresMfaAlways: roles.some((role) => role.requiresMfaAlways),
    requiresHardwareToken: roles.some((role) => role.requiresHardwareToken),
  };
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
