import { apiGet, apiPatch, apiPost } from '../auth/api-client';
import type { PersonInput } from '../supporting-operations/employee-api';

// Backlog A.2 — user provisioning and role assignment. `POST /auth/signup`
// creates an account with NO roles (and therefore no permissions); every real
// account is provisioned here, by an administrator, with the roles it needs.

/**
 * A role name is FREE TEXT chosen by the office, not one of a fixed eleven.
 *
 * This used to be a hard-coded union of the legacy catalogue, which meant the
 * provisioning screen could only ever offer those eleven — an office's own roles
 * would have been invisible here however they were granted. The list now comes
 * from `GET /rbac/roles`, and the alias is kept only so the call sites that
 * describe their intent with it keep reading clearly.
 */
export type RoleName = string;

/** One role as the catalogue returns it, with the display names an office edits.
 *  `GET /rbac/roles` needs `role.read`. */
export interface RoleCatalogueEntry {
  id: string;
  name: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  /**
   * The endpoint has always returned this and this type has always dropped it, which is why the
   * grant dropdown offered RETIRED roles. A retired role grants nothing — `findCodesForRoles`
   * filters on `role.status = 'ACTIVE'` — so granting one hands someone a row that does nothing.
   */
  status: 'ACTIVE' | 'INACTIVE';
}

export function listRoles(): Promise<RoleCatalogueEntry[]> {
  return apiGet<RoleCatalogueEntry[]>('/rbac/roles');
}

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  mfaEnabled: boolean;
  languagePreference: string;
  lastLoginAt: string | null;
  accessValidFrom: string | null;
  accessValidUntil: string | null;
  createdAt: string;
  /** Id AND name. The id is what a revoke addresses; the name is what the table
   *  shows. Matching a displayed name back to an id in the browser is exactly
   *  the habit the id-addressed API removes. */
  roles: { id: string; name: RoleName }[];
  /** The HR record this account is linked to, when there is one. What lets the
   *  unified screen show one row per PERSON — and show which half of the pair a
   *  row is still missing. */
  employeeId: string | null;
}

/** Part II §4.2.2 — a Branch or a Department, as the provisioning form's two
 * org-structure dropdowns see them. */
export interface OrgUnit {
  id: string;
  name: string;
  nameAr: string | null;
  /**
   * When this unit was retired, or null while it is live.
   *
   * REQUIRED on this interface rather than optional, even though both list reads default to
   * live-only: this file's interfaces are hand-copied over HTTP and nothing type-checks them against
   * the api, so an optional field is how a screen comes to render a retired unit as live.
   */
  retiredAt: string | null;
}

export interface ProvisionUserInput {
  /** Required for an account with NO person, and REFUSED when `employee` is present: with a person
   *  the display name is composed from the four name parts, and two spellings of one person leave
   *  nothing to say which is right. */
  fullName?: string;
  email: string;
  password: string;
  languagePreference?: 'AR' | 'EN';
  /** Part II §4.2.2 — REQUIRED, and three separate axes: Department is what
   * the person does, Branch is where they sit, Role is what the system lets
   * them do. The form must not present any two of them as one field. */
  departmentId: string;
  branchId: string;
  /** The HR record this account belongs to, when one exists. Link-only — an
   *  Employee is never created here, because it needs a national ID. Once
   *  linked, that record's four-part official name becomes the display name
   *  everywhere, and this free-text `fullName` stops being shown. */
  employeeId?: string;
  /** Role IDS. A name is unique only within an office and an office can edit it,
   *  so it is not an identity — see the API's `RoleAssignmentDto`. */
  roleIds: string[];
  /**
   * Create the person and the account in ONE request, in one transaction.
   *
   * The alternative was two calls from the browser, where the second can fail and leave a person who
   * half exists with nothing on screen to say which half. Requires `employee.create` in addition to
   * the `user.manage` this route is gated on — a Manager holds the first and not the second.
   */
  employee?: PersonInput;
  /** Recorded only; no authentication path reads it yet. */
  registrationType?: 'DEFAULT' | 'WINDOWS';
  /** Part 5.1 — the EXTERNAL_AUDITOR role's time-boxed access window. */
  accessValidFrom?: string;
  accessValidUntil?: string;
}

export function listUsers(
  page = 0,
): Promise<{ users: AdminUser[]; total: number }> {
  return apiGet(`/admin/users?page=${page}`);
}

export function provisionUser(input: ProvisionUserInput): Promise<AdminUser> {
  return apiPost('/admin/users', input);
}

export function listDepartments(): Promise<OrgUnit[]> {
  return apiGet('/admin/departments');
}

/**
 * `nameAr` is REQUIRED — owner decision, 2026-10-28. It was optional, and the consequence was a
 * unit with no Arabic name on an Arabic-first platform, rendering as its Latin name to a reader who
 * does not read it. The api refuses a body without it, so the type is what stops that arriving as a
 * 400 the screen has to explain.
 */
export function createDepartment(input: {
  name: string;
  nameAr: string;
}): Promise<OrgUnit> {
  return apiPost('/admin/departments', input);
}

export function listBranches(): Promise<OrgUnit[]> {
  return apiGet('/admin/branches');
}

/** `nameAr` is REQUIRED — see `createDepartment`. */
export function createBranch(input: {
  name: string;
  nameAr: string;
}): Promise<OrgUnit> {
  return apiPost('/admin/branches', input);
}

export function grantRole(
  userId: string,
  roleId: string,
): Promise<{ userId: string; roles: RoleName[] }> {
  return apiPost(`/admin/users/${encodeURIComponent(userId)}/roles`, {
    roleId,
  });
}

/** A POST, not a DELETE — the grant row is never deleted, only stamped
 * `revokedAt`, so the audit record of when access was withdrawn survives. */
export function revokeRole(
  userId: string,
  roleId: string,
): Promise<{ userId: string; roles: RoleName[] }> {
  return apiPost(`/admin/users/${encodeURIComponent(userId)}/roles/revoke`, {
    roleId,
  });
}

export function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<{ userId: string; isActive: boolean }> {
  return apiPost(
    `/admin/users/${encodeURIComponent(userId)}/${isActive ? 'activate' : 'deactivate'}`,
  );
}

/**
 * Rename and retire, the other half of the four-action scheme.
 *
 * `.update` and `.deactivate` are separate codes from `.create`, so a role can be given one without
 * the others — which is the whole reason these are four codes rather than one `.manage`.
 */
export function renameDepartment(
  id: string,
  input: { name?: string; nameAr?: string },
): Promise<OrgUnit> {
  return apiPatch(`/admin/departments/${encodeURIComponent(id)}`, input);
}

export function renameBranch(
  id: string,
  input: { name?: string; nameAr?: string },
): Promise<OrgUnit> {
  return apiPatch(`/admin/branches/${encodeURIComponent(id)}`, input);
}

/** Retires the unit. Existing assignments keep pointing at it; it stops being offered. */
export function deactivateDepartment(id: string): Promise<OrgUnit> {
  return apiPost(`/admin/departments/${encodeURIComponent(id)}/deactivate`, {});
}

export function deactivateBranch(id: string): Promise<OrgUnit> {
  return apiPost(`/admin/branches/${encodeURIComponent(id)}/deactivate`, {});
}

/**
 * Brings a retired unit back, on the same permission as retiring it.
 *
 * ## THESE TWO HELPERS HAVE NO CALLER YET, AND THAT IS A DECLARED STATE RATHER THAN AN OVERSIGHT
 *
 * The reactivate control is the design batch's — a screen gets opened once — so what exists here
 * today is the api, this client, and no button. Written down because it is the one arrangement that
 * keeps both halves honest, and because the alternative was worse in both directions:
 *
 *   - WITHOUT these helpers, `unreachable-routes.py` counts the two routes as addressed by nothing
 *     and FAILS (measured: 13 -> 15 by path, 7 -> 8 by controller). Its message is the right rule —
 *     *a route nothing calls is a capability nobody can exercise* — and raising the budget to get
 *     past it is forbidden.
 *   - WITH them, both route budgets stay at 13 and 7, and the gap moves to
 *     `dead-client-helpers.py`, which exists precisely to report it. That is not hiding the gap; it
 *     is putting it in the instrument built for it, which is what `CLAUDE.md` records for decision
 *     47's `getSecurityConfig()`: the route was counted reached by the helper, and the SCREEN is
 *     what later closed the dead-helper row.
 *
 * MEASURED, AND MY OWN PREDICTION WAS WRONG: that report goes **17 -> 21**, not 17 -> 19. I wrote
 * the smaller figure from the two reactivate helpers and forgot the two reads beside them — four
 * helpers, four rows (337 -> 341 route-addressing helpers in total). Corrected from the script's own
 * output rather than from the intention.
 *
 * So: when the design batch adds the control, all four stop being dead and that report drops back to
 * 17. **Do not delete them to quieten `dead-client-helpers.py`** — that re-breaks the route gate.
 */
export function reactivateDepartment(id: string): Promise<OrgUnit> {
  return apiPost(`/admin/departments/${encodeURIComponent(id)}/reactivate`, {});
}

export function reactivateBranch(id: string): Promise<OrgUnit> {
  return apiPost(`/admin/branches/${encodeURIComponent(id)}/reactivate`, {});
}

/**
 * The administrative reads, asked for the retired units too.
 *
 * Separate functions rather than an optional argument on `listDepartments`/`listBranches`: those two
 * are called by the provisioning form and by `/settings/users`, where a retired unit must never be
 * offered, and an optional flag on the shared helper is how one of those call sites eventually
 * passes it. The server defaults to live-only for the same reason.
 */
export function listDepartmentsIncludingRetired(): Promise<OrgUnit[]> {
  return apiGet('/admin/departments?includeRetired=true');
}

export function listBranchesIncludingRetired(): Promise<OrgUnit[]> {
  return apiGet('/admin/branches?includeRetired=true');
}
