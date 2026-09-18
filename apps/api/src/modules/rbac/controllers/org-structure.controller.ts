import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OrgStructureService } from '../services/org-structure.service';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CreateOrgUnitDto } from '../dto/org-structure.dto';

const orgUnitSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    name: { type: 'string' as const },
    nameAr: { type: 'string' as const, nullable: true },
  },
  required: ['id', 'name'],
};

/**
 * Part II §4.2.2 — the Department and Branch lookups the provisioning form
 * needs. Both were required by the spec and neither was creatable through the
 * API, which made §4.2.2's "admin fills Branch and Department" hollow: the
 * only way to obtain an id was a hand-written INSERT.
 *
 * Gated by `@RequirePermissions` alone, the same as
 * `UserAdminController`, and deliberately the same `user.manage` permission —
 * see `OrgStructureService` for why this is not a permission of its own.
 *
 * Deliberately create + list only. Renaming or deleting an org unit has
 * consequences for every row pointing at it (a `User.departmentId` FK is
 * `ON DELETE SET NULL`, which would silently empty a required field), and
 * nothing in §4.2.2 asks for it.
 */
@ApiTags('org-structure')
@Controller('admin')
export class OrgStructureController {
  constructor(private readonly orgStructure: OrgStructureService) {}

  @RequirePermissions('user.manage')
  @Get('departments')
  @ApiOkResponse({
    description: "This office's departments, by name.",
    schema: { type: 'array', items: orgUnitSchema },
  })
  listDepartments() {
    return this.orgStructure.listDepartments();
  }

  @RequirePermissions('user.manage')
  @Post('departments')
  @ApiOkResponse({
    description: 'The created department.',
    schema: orgUnitSchema,
  })
  createDepartment(
    @Body() dto: CreateOrgUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.createDepartment(dto, user.id);
  }

  @RequirePermissions('user.manage')
  @Get('branches')
  @ApiOkResponse({
    description: "This office's branches, by name.",
    schema: { type: 'array', items: orgUnitSchema },
  })
  listBranches() {
    return this.orgStructure.listBranches();
  }

  @RequirePermissions('user.manage')
  @Post('branches')
  @ApiOkResponse({ description: 'The created branch.', schema: orgUnitSchema })
  createBranch(
    @Body() dto: CreateOrgUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.createBranch(dto, user.id);
  }
}
