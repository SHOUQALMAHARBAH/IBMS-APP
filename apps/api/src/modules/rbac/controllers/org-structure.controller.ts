import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OrgStructureService } from '../services/org-structure.service';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CreateOrgUnitDto, RenameOrgUnitDto } from '../dto/org-structure.dto';
import { BRANCH_SEARCH_CODES } from '../../../common/picker-search.config';
import { SearchBranchesDto } from '../../../common/picker-search.dto';

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

  /*
   * AN ANY-OF SO THE PROVIDER CAN POPULATE ITS OWN PROVISIONING FORM — owner decision, 2026-10-17.
   *
   * `provision-user.dto.ts` makes `departmentId` and `branchId` FLATLY REQUIRED, and
   * `PLATFORM_OPERATOR` holds `user.manage` but neither read code — so `/settings/users` could not
   * fill two mandatory fields and the provider could not create a user at all.
   *
   * ## THE CODE NAMED HERE IS NOT THE OBVIOUS ONE, AND THE REASON IS THE WHOLE POINT
   *
   * The owner's reasoning pointed at `user.manage`: whoever is trusted to PROVISION a user is
   * trusted to read the two lists the provisioning form makes mandatory. Her acceptance criterion,
   * though, is that a widening is specified by the EXACT ROLE SET it produces and NOT by the code
   * chosen — "measure who else holds the code you are about to name, because the any-of reaches
   * every holder". Measured:
   *
   *   branch.read / department.read -> BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR,
   *                                    SYSTEM_SECURITY_ADMINISTRATOR
   *   user.manage                   -> OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR
   *                                    + PLATFORM_OPERATOR + INSURANCE_COMPANY_ADMINISTRATOR
   *
   * So her office-side expectation verified exactly — `user.manage`'s office holders already hold
   * the read codes, so the net office-side addition is nil. But `user.manage` also reaches a FIFTH
   * role, `INSURANCE_COMPANY_ADMINISTRATOR`, and her decided set is four.
   *
   * And that is not a code-search failure, it is PROVEN: the company administrator's six codes are a
   * strict SUBSET of the provider's eleven, so EVERY code shared between the provider and an office
   * role is also held by the company administrator. No shared code can separate those two roles.
   * Only a `provider.*` code can, because those five are held by `PLATFORM_OPERATOR` alone.
   *
   * `provider.office.administrator.invite` yields EXACTLY the decided set — the three read-code
   * holders plus the provider, and nobody else — and it is the aptest of the five: whoever may invite
   * an office administrator may read the organizational lists that provisioning an administrator
   * requires.
   *
   * ## AND THE SET IS STRUCTURALLY STABLE, NOT MERELY CORRECT TODAY
   *
   * That code is `PermissionScope.PLATFORM`, so it can never be granted to an office role: the role
   * matrix never offers it, `setPermissions` refuses it for a non-provider organization, and the grid
   * guard requires a PLATFORM code to name no role at all. A later office role therefore cannot drift
   * into these routes through this disjunct — which an OFFICE-scoped code like `user.manage` could
   * not promise.
   *
   * ## WHAT THIS DOES NOT DISCLOSE
   *
   * Both routes are tenant-scoped, so the provider reads ITS OWN branches and departments and no
   * office's. The widening adds no cross-office reach, which is why it is an any-of rather than a
   * separate provider-facing route.
   *
   * RAISED AND NOT DECIDED: `INSURANCE_COMPANY_ADMINISTRATOR` is in the IDENTICAL deadlock — it holds
   * `user.manage`, faces the same two mandatory fields, and its two declared rows for
   * `/settings/users` are not covered by this decision. Left refused, recorded in the register.
   */
  @RequirePermissions('department.read', 'provider.office.administrator.invite')
  @Get('departments')
  @ApiOkResponse({
    description: "This office's departments, by name.",
    schema: { type: 'array', items: orgUnitSchema },
  })
  listDepartments() {
    return this.orgStructure.listDepartments();
  }

  @RequirePermissions('department.create')
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

  /**
   * THE BRANCH PICKER's source. Gated on ANY OF `BRANCH_SEARCH_CODES`.
   *
   * That list is the union of the permissions of the screens that type a `branchId`, per the owner's
   * rule — and the rule exists because the opposite shipped twice, most sharply when
   * `GET /employees/search` was gated on `employee.national-id.reveal` and an Executive therefore could
   * not find an employee on the employee performance screen. `PermissionsGuard` ORs its codes, so the
   * spread is exactly "any one of these is enough".
   *
   * Declared BEFORE any `:id` route so `search` is never parsed as an id.
   */
  @RequirePermissions(...BRANCH_SEARCH_CODES)
  @Get('branches/search')
  searchBranchesForPicker(@Query() query: SearchBranchesDto) {
    return this.orgStructure.searchBranchesForPicker(query);
  }

  /* The same any-of, for the same measured reason — see the note on `GET departments` above.
   * Kept as a pointer rather than a second copy: two copies of that reasoning is two places for
   * one of them to be relaxed without the other. */
  @RequirePermissions('branch.read', 'provider.office.administrator.invite')
  @Get('branches')
  @ApiOkResponse({
    description: "This office's branches, by name.",
    schema: { type: 'array', items: orgUnitSchema },
  })
  listBranches() {
    return this.orgStructure.listBranches();
  }

  @RequirePermissions('branch.create')
  @Post('branches')
  @ApiOkResponse({ description: 'The created branch.', schema: orgUnitSchema })
  createBranch(
    @Body() dto: CreateOrgUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.createBranch(dto, user.id);
  }

  /**
   * Rename. Four separate codes per entity is the owner's scheme, and `.update` is the one a role
   * can be given without `.create` or `.deactivate` — which is the entire point of splitting them.
   */
  @RequirePermissions('department.update')
  @Patch('departments/:id')
  @ApiOkResponse({
    description: 'The renamed department.',
    schema: orgUnitSchema,
  })
  renameDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameOrgUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.renameDepartment(id, dto, user.id);
  }

  @RequirePermissions('branch.update')
  @Patch('branches/:id')
  @ApiOkResponse({ description: 'The renamed branch.', schema: orgUnitSchema })
  renameBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameOrgUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.renameBranch(id, dto, user.id);
  }

  /**
   * Retire, never delete. `User.departmentId` and `Employee.departmentId` point here, so a unit a
   * person was once assigned to stays readable on that person's record; it simply stops being
   * offered for new ones.
   */
  @RequirePermissions('department.deactivate')
  @Post('departments/:id/deactivate')
  @ApiOkResponse({
    description: 'The retired department.',
    schema: orgUnitSchema,
  })
  deactivateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.deactivateDepartment(id, user.id);
  }

  @RequirePermissions('branch.deactivate')
  @Post('branches/:id/deactivate')
  @ApiOkResponse({ description: 'The retired branch.', schema: orgUnitSchema })
  deactivateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orgStructure.deactivateBranch(id, user.id);
  }
}
