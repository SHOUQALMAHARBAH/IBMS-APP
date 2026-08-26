import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleRepository } from '../../../repositories/role.repository';
import { PermissionRepository } from '../../../repositories/permission.repository';
import { RequireRoles } from '../../auth/decorators/require-roles.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';

const roleListSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const },
      name: { type: 'string' as const },
      description: { type: 'string' as const, nullable: true },
    },
    required: ['id', 'name'],
  },
};

const permissionListSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const },
      code: { type: 'string' as const },
      module: { type: 'string' as const },
      description: { type: 'string' as const, nullable: true },
    },
    required: ['id', 'code', 'module'],
  },
};

/** Part 5.1 / Process #40 — read-only views over the role/permission
 * catalogue. Gated by both @RequireRoles (belt-and-suspenders while
 * @RequirePermissions isn't yet the only gate anywhere in the app) and
 * @RequirePermissions, which is the pattern every future sensitive
 * endpoint should follow once Part C's business modules land. */
@ApiTags('rbac')
@Controller('rbac')
export class RbacController {
  constructor(
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionRepository,
  ) {}

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('role.manage')
  @Get('roles')
  @ApiOkResponse({
    description: 'The 11-role catalogue.',
    schema: roleListSchema,
  })
  listRoles() {
    return this.roles.findAll();
  }

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('permission.manage')
  @Get('permissions')
  @ApiOkResponse({
    description: 'The full permission grid.',
    schema: permissionListSchema,
  })
  listPermissions() {
    return this.permissions.findAll();
  }
}
