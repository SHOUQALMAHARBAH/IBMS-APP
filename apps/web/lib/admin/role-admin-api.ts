import { apiGet, apiPatch, apiPost, apiPut } from '../auth/api-client';

/**
 * Office-scoped custom RBAC, PHASE 3 — the Role screen's client.
 *
 * Separate from `user-admin-api.ts` on purpose. That file provisions PEOPLE and
 * needs a role catalogue only to fill a dropdown, which is why its
 * `RoleCatalogueEntry` is deliberately the five display fields and nothing else.
 * This file is about the roles themselves: their status, their protection flag,
 * their security attributes, their grants, and who holds them.
 *
 * Two permissions, and the names matter. `role.read` reads the catalogue;
 * `role.manage` changes it. They were one badly-named code until the Phase 3 prep
 * step split them, precisely so this screen could offer a read-only view to a
 * caller who may look but not edit.
 */

/** A role as the admin catalogue returns it — every role the office has,
 *  RETIRED ONES INCLUDED. A screen that hid retired roles would leave an office
 *  unable to reactivate one, which is the only way back. */
export interface RoleAdminEntry {
  id: string;
  /** The stable machine name. An office can rename the display names freely; this
   *  is what grants and audit rows are written against. */
  name: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** A role the PLATFORM defines. GRANTS NOTHING — it makes this screen refuse to
   *  rename, retire or re-grant the row, and is read nowhere else. */
  isSystem: boolean;
  requiresMfaAlways: boolean;
  requiresHardwareToken: boolean;
  /** Live grants only. What makes retiring a role an informed decision rather
   *  than a guess. */
  holderCount: number;
  permissionCount: number;
}

export interface RoleWithGrants extends RoleAdminEntry {
  permissionCodes: string[];
}

/** One code from the global catalogue. The catalogue describes the software, not
 *  any office's configuration, so it carries no organization and every office
 *  sees all of it. */
export interface PermissionCatalogueEntry {
  code: string;
  module: string;
  description: string;
}

export function listRolesForAdmin(): Promise<RoleAdminEntry[]> {
  return apiGet<RoleAdminEntry[]>('/rbac/roles');
}

export function getRoleWithGrants(roleId: string): Promise<RoleWithGrants> {
  return apiGet<RoleWithGrants>(`/rbac/roles/${encodeURIComponent(roleId)}`);
}

export function listPermissionCatalogue(): Promise<PermissionCatalogueEntry[]> {
  return apiGet<PermissionCatalogueEntry[]>('/rbac/permissions');
}

export interface CreateRoleInput {
  name: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  permissionCodes?: string[];
}

export function createRole(input: CreateRoleInput): Promise<RoleAdminEntry> {
  return apiPost('/rbac/roles', input);
}

export function updateRole(
  roleId: string,
  input: { nameEn?: string; nameAr?: string; description?: string },
): Promise<RoleAdminEntry> {
  return apiPatch(`/rbac/roles/${encodeURIComponent(roleId)}`, input);
}

/** The whole grant set at once, never one code per request: a partial save would
 *  leave a role half-built, and the matrix submits the state it believes. */
export function setRolePermissions(
  roleId: string,
  permissionCodes: string[],
): Promise<unknown> {
  return apiPut(`/rbac/roles/${encodeURIComponent(roleId)}/permissions`, {
    permissionCodes,
  });
}

/**
 * The two Part II §4.4 / Part 10.1 security attributes, behind a FRESH step-up
 * challenge — the endpoint carries `@RequireStepUp()` and is its first consumer
 * anywhere.
 *
 * Both default to the strict value, so relaxing one WEAKENS a control. A control
 * an administrator can weaken from a screen with no re-authentication is weaker
 * than it looks, which is why this is the one Role operation that re-prompts.
 */
export function setRoleSecurityAttributes(
  roleId: string,
  input: { requiresMfaAlways: boolean; requiresHardwareToken: boolean },
): Promise<RoleAdminEntry> {
  return apiPatch(
    `/rbac/roles/${encodeURIComponent(roleId)}/security-attributes`,
    input,
  );
}

/** A POST, not a DELETE — there is no delete. `Role.status` is the only removal
 *  there is, because the grant rows pointing at a role ARE the record of who held
 *  what and when. */
export function setRoleStatus(
  roleId: string,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<RoleAdminEntry> {
  return apiPost(
    `/rbac/roles/${encodeURIComponent(roleId)}/${status === 'ACTIVE' ? 'reactivate' : 'retire'}`,
  );
}

/**
 * Part 5.1 / `checker-roles.config.ts` — the one pair in the whole catalogue
 * where BOTH halves of a maker/checker split are permissions, so both can be
 * checked on the same role from this screen.
 *
 * It WARNS and saves anyway, which was an explicit decision. A small office may
 * legitimately want one role for both, and `assertDifferentActors` still refuses
 * a co-sign by whoever recorded the classification — instance-level independence
 * holds however the roles are arranged. The warning exists because role-level
 * independence becomes a configuration choice in this phase, and a configuration
 * choice nobody was told about is not a choice.
 *
 * The other twelve checker codes pair a permission against an ordinary business
 * action, so there is no second checkbox to warn about; the segregation signal on
 * role ASSIGNMENT covers all thirteen and stays the primary detective control.
 */
export const SEGREGATION_WARNING_PAIR = [
  'incident.classify',
  'incident.classification.co-sign',
] as const;

export function violatesSegregationPair(
  selected: ReadonlySet<string>,
): boolean {
  return SEGREGATION_WARNING_PAIR.every((code) => selected.has(code));
}
