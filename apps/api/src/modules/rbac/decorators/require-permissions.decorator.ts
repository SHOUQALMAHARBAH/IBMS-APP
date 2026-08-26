import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';

/** Gate a route to users holding at least one of the given permission codes
 * (resolved from their roles via RolePermission). Mirrors @RequireRoles —
 * see auth/decorators/require-roles.decorator.ts — but checks the
 * fine-grained permission grid instead of a role name directly. */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);
