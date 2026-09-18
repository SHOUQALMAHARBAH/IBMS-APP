import { apiGet, apiPost } from '../auth/api-client';

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
}

/** Part II §4.2.2 — a Branch or a Department, as the provisioning form's two
 * org-structure dropdowns see them. */
export interface OrgUnit {
  id: string;
  name: string;
  nameAr: string | null;
}

export interface ProvisionUserInput {
  fullName: string;
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

export function createDepartment(input: {
  name: string;
  nameAr?: string;
}): Promise<OrgUnit> {
  return apiPost('/admin/departments', input);
}

export function listBranches(): Promise<OrgUnit[]> {
  return apiGet('/admin/branches');
}

export function createBranch(input: {
  name: string;
  nameAr?: string;
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
