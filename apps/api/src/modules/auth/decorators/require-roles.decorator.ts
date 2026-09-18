import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ROLES_KEY = 'requireRoles';

/**
 * Gate a route to users holding at least one of the given roles BY NAME.
 *
 * ⚠️ PHASE 2 REMOVAL TARGET. Office-scoped custom roles made a role name
 * meaningful only within one office, so a name gate cannot express "an
 * administrator of THIS office" any more — a custom admin role is hard-blocked
 * from every one of the 17 routes still carrying this decorator.
 *
 * The replacement is `@RequirePermissions`, which most of those routes already
 * carry alongside this one as belt-and-braces. Phase 2 verifies the permission
 * gate is equivalent ROUTE BY ROUTE and only then removes this — deleting the
 * decorator first would silently open any route where it is the ONLY gate,
 * which is what the inventory spec in test #27 exists to prevent.
 *
 * Do not add new call sites.
 */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRE_ROLES_KEY, roles);
