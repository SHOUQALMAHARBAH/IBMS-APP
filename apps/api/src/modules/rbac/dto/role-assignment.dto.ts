import { IsUUID } from 'class-validator';

/**
 * Backlog A.2 — grant or revoke a single role, addressed by ID.
 *
 * ## Why an id and not a name
 *
 * A role name is unique only WITHIN an office, so a name is not an identity —
 * the same reasoning that made `PermissionRepository.findCodesForRoles` take
 * ids in Phase 1. Addressing by name was not a security hole here (the lookup
 * was office-scoped, so a name from another office simply resolved to nothing),
 * but it left a real rename-mid-request race: an administrator renaming a role
 * between the client rendering the list and submitting the grant would get a
 * 422 for a role that exists, or — worse, once an office reuses a freed name —
 * a grant of the wrong role. A uuid cannot drift.
 *
 * It also removes the last place in this API where something
 * security-relevant is addressed by a name an office can edit.
 *
 * The id is validated as a uuid, but `UserAdminService` is what decides whether
 * it EXISTS: the lookup runs on the tenant-scoped client, so another office's
 * role id resolves to nothing and answers 422 — indistinguishable from an id
 * that never existed, which is what stops one office probing another's roles.
 */
export class RoleAssignmentDto {
  @IsUUID()
  roleId!: string;
}
