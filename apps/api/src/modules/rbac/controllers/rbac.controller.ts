import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleRepository } from '../../../repositories/role.repository';
import { PermissionRepository } from '../../../repositories/permission.repository';
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
 * catalogue. Gated by @RequirePermissions alone — the pattern every sensitive
 * endpoint should follow once Part C's business modules land. */
@ApiTags('rbac')
@Controller('rbac')
export class RbacController {
  constructor(
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionRepository,
  ) {}

  // `role.read`, not `role.manage`: this reads the catalogue. `role.manage` now
  // means changing it, and Phase 3's CRUD is what will carry that.
  @RequirePermissions('role.read')
  @Get('roles')
  @ApiOkResponse({
    description: "The office's own role catalogue.",
    schema: roleListSchema,
  })
  listRoles() {
    return this.roles.findAll();
  }

  @RequirePermissions('permission.read')
  @Get('permissions')
  @ApiOkResponse({
    description: 'The full permission grid.',
    schema: permissionListSchema,
  })
  listPermissions() {
    return this.permissions.findAll();
  }
}
