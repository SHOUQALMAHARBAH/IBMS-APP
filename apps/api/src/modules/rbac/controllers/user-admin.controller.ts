import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserAdminService } from '../services/user-admin.service';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { ProvisionUserDto } from '../dto/provision-user.dto';
import { RoleAssignmentDto } from '../dto/role-assignment.dto';
import { USER_SEARCH_CODES } from '../../../common/picker-search.config';
import { SearchUsersDto } from '../../../common/picker-search.dto';

const adminUserSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    fullName: { type: 'string' as const },
    email: { type: 'string' as const },
    isActive: { type: 'boolean' as const },
    mfaEnabled: { type: 'boolean' as const },
    languagePreference: { type: 'string' as const },
    lastLoginAt: { type: 'string' as const, nullable: true },
    accessValidFrom: { type: 'string' as const, nullable: true },
    accessValidUntil: { type: 'string' as const, nullable: true },
    createdAt: { type: 'string' as const },
    roles: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['id', 'fullName', 'email', 'isActive', 'roles'],
};

/**
 * Backlog A.2 — user provisioning and role assignment, the surface the
 * `user.manage` permission was seeded for and which had no endpoint until
 * now. Gated by `@RequirePermissions`, the same
 * belt-and-braces pattern `RbacController` uses for the read-only catalogue.
 *
 * Frontend: apps/web/app/(app)/settings/users/page.tsx.
 */
@ApiTags('user-admin')
@Controller('admin/users')
export class UserAdminController {
  constructor(private readonly userAdmin: UserAdminService) {}

  /**
   * THE USER PICKER's source. Gated on ANY OF `USER_SEARCH_CODES`.
   *
   * That list is the union of the permissions of the screens that type a `ownerUserId`, per the owner's
   * rule — and the rule exists because the opposite shipped twice, most sharply when
   * `GET /employees/search` was gated on `employee.national-id.reveal` and an Executive therefore could
   * not find an employee on the employee performance screen. `PermissionsGuard` ORs its codes, so the
   * spread is exactly "any one of these is enough".
   *
   * Declared BEFORE any `:id` route so `search` is never parsed as an id.
   */
  @RequirePermissions(...USER_SEARCH_CODES)
  @Get('search')
  searchForPicker(
    @Query() query: SearchUsersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAdmin.searchForPicker(query, user);
  }

  @RequirePermissions('user.manage')
  @Get()
  @ApiOkResponse({
    description: 'One capped page of user accounts with their active roles.',
    schema: {
      type: 'object',
      properties: {
        users: { type: 'array', items: adminUserSchema },
        total: { type: 'integer' },
      },
      required: ['users', 'total'],
    },
  })
  list(@Query('page', new ParseIntPipe({ optional: true })) page?: number) {
    return this.userAdmin.list(page ?? 0);
  }

  @RequirePermissions('user.manage')
  @Post()
  @ApiOkResponse({
    description: 'The provisioned account with its initial role grants.',
    schema: adminUserSchema,
  })
  provision(
    @Body() dto: ProvisionUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAdmin.provision(dto, user.id, user.roleIds);
  }

  @RequirePermissions('user.manage')
  @Post(':id/roles')
  grantRole(
    @Param('id') id: string,
    @Body() dto: RoleAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAdmin.grantRole(id, dto.roleId, user.id);
  }

  /** A POST, not a DELETE — the grant row is never deleted, only stamped
   * `revokedAt` (see `UserRoleAssignment.revokedAt` in the schema). */
  @RequirePermissions('user.manage')
  @Post(':id/roles/revoke')
  revokeRole(
    @Param('id') id: string,
    @Body() dto: RoleAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAdmin.revokeRole(id, dto.roleId, user.id);
  }

  @RequirePermissions('user.manage')
  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.userAdmin.setActive(id, false, user.id);
  }

  @RequirePermissions('user.manage')
  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.userAdmin.setActive(id, true, user.id);
  }
}
