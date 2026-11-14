import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
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
import { OrganizationRepository } from '../../../repositories/organization.repository';
import { UserRepository } from '../../../repositories/user.repository';
import { PermissionsService } from '../services/permissions.service';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { SetRoleScopeDto } from '../dto/role-scope.dto';

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
      /** OWNER DECISION 131 — «جديدة»: this code arrived after this office was created, no role
       *  here holds it, and this office has not ruled on it. Per-office, so the same catalogue
       *  row reads differently for two offices, which is the whole point. */
      isNew: { type: 'boolean' as const },
    },
    required: ['id', 'code', 'module', 'isNew'],
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
    /** OWNER DECISION 131 — the mark is per-office, so the grid read needs the office's row and
     *  the rule that reads it. */
    private readonly organizations: OrganizationRepository,
    private readonly permissionsService: PermissionsService,
    private readonly users: UserRepository,
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

  /**
   * The operations that need two people, and whether this office has them. Part 5's honesty fix: gated on
   * `role.read` because it describes the office's permission arrangement, which is what that code is for,
   * and because the audience is whoever arranges it.
   */
  @RequirePermissions('role.read')
  @Get('duty-segregation-readiness')
  dutySegregationReadiness() {
    return this.roleAdmin.dutySegregationReadiness();
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
  /**
   * MODULE 0 ITEM (h) — a role's insurance-line scope.
   *
   * `role.update`, the same code as the rest of role configuration, and NO `@RequireStepUp()`:
   * step-up guards the MFA attributes because relaxing one WEAKENS a security control, and a scope
   * only ever narrows what a role reaches. Stated because the neighbouring route has it and a
   * reader would otherwise wonder whether it was forgotten.
   */
  @RequirePermissions('role.update')
  @Patch('roles/:id/scope')
  setRoleScope(
    @Param('id') id: string,
    @Body() dto: SetRoleScopeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roleAdmin.setScope(id, dto, user.id);
  }

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
  async listPermissions(@CurrentUser() user: AuthenticatedUser) {
    /*
     * OWNER DECISION 131: the grid is the same for every office — `Permission` is global and
     * stays global — but the MARK is not. A code is «جديدة» for an office that has not decided
     * on it and not for one that has, so the mark is computed against the caller's own office
     * and merged here rather than stored on the row.
     */
    const [rows, marks] = await Promise.all([
      this.permissions.findAll(),
      this.markFor(user),
    ]);
    return rows.map((row) => ({ ...row, isNew: marks.has(row.code) }));
  }

  /**
   * OWNER DECISION 131's second way of deciding — «أو يقرّر فيها».
   *
   * The administrator looked at the code and chose not to grant it. That clears the mark in THIS
   * office and nowhere else (criterion 5), because the row is tenant-scoped with a FORCED policy.
   *
   * GATED ON `role.update`, the same code that gates `PUT roles/:id/permissions`: the person who
   * could have granted it is the person who may decline it. ⛔ Not a new permission of its own —
   * minting one would mean an office could be configured so that somebody may grant a code but
   * not dismiss it, which makes the mark unclearable for them and is a worse state than either.
   */
  @RequirePermissions('role.update')
  @Post('permissions/:code/dismiss')
  async dismissPermission(
    @Param('code') code: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [permission] = await this.permissions.findByCodes([code]);
    if (!permission) {
      throw new NotFoundException(`Unknown permission code "${code}".`);
    }
    /*
     * THE NAME THROUGH `displayNameForUserId`, NEVER `findById().fullName` — OWNER DECISION 48.
     *
     * `Employee.fullName` is composed from the four Jordanian name parts and is the real
     * identity; `User.fullName` is free text and is only the fallback for an account with no HR
     * record. In the demo data ALL SIXTEEN linked accounts disagree, the user row holding an
     * English ROLE LABEL. This is a register of who decided an office would not grant a
     * permission, so «Compliance Officer» here would be a record naming nobody.
     */
    const shown =
      (await this.users.displayNameForUserId(user.id)) ?? user.email;
    await this.permissions.dismissForOffice({
      organizationId: user.organizationId,
      permissionId: permission.id,
      dismissedByUserId: user.id,
      // The name AS IT STOOD, for the same reason `DeclaredAct` keeps one: a record of a
      // decision that can only name a uuid is a record nobody can read.
      dismissedByNameShown: shown,
    });
    return { code, dismissed: true };
  }

  /** The set of codes marked «جديدة» for this caller's office. */
  private async markFor(user: AuthenticatedUser): Promise<Set<string>> {
    const office = await this.organizations.findById(user.organizationId);
    // No office row means no `createdAt` to compare against, and condition 1 cannot be evaluated.
    // An EMPTY set is the right answer: showing no mark is a missing nudge, while showing every
    // code as new would be the noise the mark is designed to avoid.
    if (!office) return new Set();
    const marked = await this.permissionsService.markedCodesForOffice(
      user.organizationId,
      office.createdAt,
    );
    return new Set(marked);
  }
}
