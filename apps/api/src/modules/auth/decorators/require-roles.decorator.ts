import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '@ibms/db';

export const REQUIRE_ROLES_KEY = 'requireRoles';

/** Gate a route to users holding at least one of the given roles. */
export const RequireRoles = (...roles: RoleName[]) =>
  SetMetadata(REQUIRE_ROLES_KEY, roles);
