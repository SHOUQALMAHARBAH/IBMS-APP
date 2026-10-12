import { ForbiddenException } from '@nestjs/common';
import type { InsuranceLineCategory } from '@ibms/db';
import type { AuthenticatedUser } from '../modules/auth/auth.types';

/**
 * MODULE 0 ITEM (h) — THE ONE PLACE A ROLE'S SCOPE IS DECIDED.
 *
 * The full reasoning is `docs/decision-role-scope.md`, written before this file. The three things a
 * reader needs here:
 *
 * ## 1. Why this is not in `PermissionsGuard`
 *
 * The guard runs BEFORE the handler and has no resource. "May this user place a policy?" is
 * answerable there; "may this user place a policy IN THE LIFE LINE?" is not, because the line
 * arrives in the body or behind an id the guard has not loaded. So scope is decided where the
 * resource is known, which is the service — the same shape the fifteen maker/checker pairs already
 * have.
 *
 * ## 2. Why several roles UNION rather than intersect
 *
 * A user holding a GENERAL-scoped Manager role and an unscoped Compliance role may act on both: if
 * ANY role that grants the code covers the resource's line, the act is permitted. Intersecting
 * would leave that person able to act on nothing, which is not what either grant says.
 *
 * ## 3. Why NULL and empty are UNRESTRICTED
 *
 * Every role that existed before item (h) carries no scope. Reading that as "scoped to nothing"
 * would refuse every write in the system on the first deploy. So a NULL category means every type
 * and an empty branch list means every branch within the type — the non-restricting reading, the
 * same call item (b) made for `brokerKind`.
 *
 * ⚠️ This decision must exist in exactly ONE place. `role-scope.inventory.spec.ts` fails if the
 * comparison is copied anywhere, because two copies is how one of them comes back looser than it
 * went in — which this repository has already measured twice.
 */

/** The line a write is about, as the caller already knows it. */
export interface ScopedResource {
  /** The branch's own catalogue category. Never supplied by a client — read from the catalogue. */
  category: InsuranceLineCategory;
  /** The catalogue row, standard or office-added. Either id; whichever the resource carries. */
  lineId: string;
}

/** One role's scope, as the session resolves it. */
export interface RoleScope {
  roleId: string;
  /** NULL = every insurance type. */
  category: InsuranceLineCategory | null;
  /** Empty = every branch within `category`. */
  lineIds: readonly string[];
}

/**
 * Whether ONE role scope covers one resource.
 *
 * Exported for the Role screen and the tests to reason about a single scope; the authorization
 * answer is `assertWithinRoleScope`, which unions.
 */
export function scopeCovers(
  scope: RoleScope,
  resource: ScopedResource,
): boolean {
  // Unrestricted type.
  if (scope.category === null) return true;
  if (scope.category !== resource.category) return false;
  // Unrestricted within the type.
  if (scope.lineIds.length === 0) return true;
  return scope.lineIds.includes(resource.lineId);
}

/**
 * Whether the caller may act on a resource in this line.
 *
 * `null`/empty scopes mean unrestricted, so a user with no scoped role at all is permitted — which
 * is every user in every office that has not configured a scope, and is the reason this returns
 * true rather than false on an empty set. A `false` default here would have been a system-wide
 * outage on the deploy that added the column.
 */
export function withinRoleScope(
  user: Pick<AuthenticatedUser, 'roleScopes'>,
  resource: ScopedResource,
): boolean {
  const scopes = user.roleScopes ?? [];
  if (scopes.length === 0) return true;
  return scopes.some((scope) => scopeCovers(scope, resource));
}

/**
 * The refusal. Names the SCOPE and the LINE, never just "forbidden".
 *
 * A 403 that does not say which scope refused sends the reader to ask for a permission they already
 * hold — the same reason the refusal sentences name the grantor by function. Here the fix is not a
 * grant at all: it is a change to the role's scope, or the act belongs to somebody else.
 */
export function assertWithinRoleScope(
  user: Pick<AuthenticatedUser, 'roleScopes'>,
  resource: ScopedResource,
  what: string,
): void {
  if (withinRoleScope(user, resource)) return;
  const scopes = user.roleScopes ?? [];
  const described = scopes
    .map((s) =>
      s.category === null
        ? 'every insurance type'
        : s.lineIds.length === 0
          ? `${s.category} (every branch)`
          : `${s.category} (${s.lineIds.length} branch(es))`,
    )
    .join('; ');
  throw new ForbiddenException(
    `Your role scope does not cover this insurance line, so you cannot ${what} in it. ` +
      `Your roles are scoped to: ${described}. This line is ${resource.category}. ` +
      'A permission grant will not change this — ask whoever manages roles in your office to widen ' +
      'the role scope, or pass the work to somebody scoped for it.',
  );
}
