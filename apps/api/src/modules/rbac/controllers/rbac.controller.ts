import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleRepository } from '../../../repositories/role.repository';
import { RoleAdminService } from '../services/role-admin.service';
import { RequireStepUp } from '../../auth/decorators/require-step-up.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  CreateRoleDto,
  RoleSecurityAttributesDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from '../dto/role-crud.dto';
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
    private readonly roleAdmin: RoleAdminService,
  ) {}

  // `role.read`, not a write code: this reads the catalogue. The write codes now
  // means changing it, and Phase 3's CRUD is what will carry that.
  @RequirePermissions('role.read')
  @Get('roles')
  @ApiOkResponse({
    description: "The office's own role catalogue.",
    schema: roleListSchema,
  })
  listRoles() {
    // The admin shape: every role the office has, RETIRED ONES INCLUDED, with the
    // holder count that makes retiring one an informed decision. A screen that
    // hid retired roles would leave an office unable to reactivate one, which is
    // the only way back.
    return this.roleAdmin.list();
  }

  @RequirePermissions('role.read')
  @Get('roles/:id')
  @ApiOkResponse({
    description: 'One role and the permission codes it grants.',
  })
  getRole(@Param('id') id: string) {
    return this.roleAdmin.get(id);
  }

  @RequirePermissions('role.create')
  @Post('roles')
  createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roleAdmin.create(dto, user.id);
  }

  @RequirePermissions('role.update')
  @Patch('roles/:id')
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roleAdmin.update(id, dto, user.id);
  }

  /** The whole grant set at once, not one code per request: a partial save would
   *  leave a role half-built, and the matrix submits the state it believes. */
  @RequirePermissions('role.update')
  @Put('roles/:id/permissions')
  setRolePermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roleAdmin.setPermissions(id, dto.permissionCodes, user.id);
  }

  /**
   * The two Part II §4.4 / Part 10.1 security attributes, behind a FRESH step-up
   * challenge.
   *
   * These decide whether a trusted device can shorten the second factor and
   * whether the role is flagged for WebAuthn. Both default to the strict value,
   * so relaxing one weakens a control — and a control an administrator can weaken
   * from a screen with no re-authentication is weaker than it looks.
   *
   * This is the FIRST consumer of `@RequireStepUp`. The gate has existed since
   * backlog A.1 with no business endpoint to attach to; its own comment said so.
   */
  @RequirePermissions('role.update')
  @RequireStepUp()
  @Patch('roles/:id/security-attributes')
  setRoleSecurityAttributes(
    @Param('id') id: string,
    @Body() dto: RoleSecurityAttributesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roleAdmin.setSecurityAttributes(id, dto, user.id);
  }

  /** A POST, not a DELETE — there is no delete. `Role.status` is the only removal
   *  there is, because the grant rows pointing here are the record of who held
   *  what and when. */
  /**
   * Delete a role. Soft by mechanism, immediate by behaviour — see `RoleAdminService.remove`.
   *
   * `@HttpCode(204)`: there is nothing meaningful to return, and returning the deleted row would
   * invite a screen to render it.
   */
  @RequirePermissions('role.deactivate')
  @Delete('roles/:id')
  @HttpCode(204)
  async removeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.roleAdmin.remove(id, user.id);
  }

  @RequirePermissions('role.deactivate')
  @Post('roles/:id/retire')
  @HttpCode(200)
  retireRole(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roleAdmin.setStatus(id, 'INACTIVE', user.id);
  }

  @RequirePermissions('role.deactivate')
  @Post('roles/:id/reactivate')
  @HttpCode(200)
  reactivateRole(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roleAdmin.setStatus(id, 'ACTIVE', user.id);
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
