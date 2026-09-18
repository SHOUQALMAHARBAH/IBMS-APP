import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';

/** Gate a route to users holding at least one of the given permission codes
 * (resolved from their roles via RolePermission).
 *
 * Since Phase 2 this is the ONLY authorization decorator: `@RequireRoles` and
 * its guard are gone, because a role name is unique only within one office and
 * so cannot express "an administrator of THIS office". */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);
