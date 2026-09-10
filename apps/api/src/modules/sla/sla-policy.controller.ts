import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SlaPolicyService } from './sla-policy.service';
import { PermissionsService } from '../rbac/services/permissions.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateSlaPolicyDto,
  ListSlaPoliciesDto,
  UpdateSlaPolicyDto,
} from './dto/sla-policy.dto';

/** Changing an SLA's stated legal force is controlled separately from changing
 * its duration — see `SlaPolicyService.update`. */
const REGULATORY_METADATA_PERMISSION = 'sla.policy.regulatory';

/**
 * Configurable SLA policies (task Part A).
 *
 * `sla.policy.read` to see them, `sla.policy.manage` to create/edit/activate,
 * and `sla.policy.regulatory` on top for the fields that assert an SLA is
 * legally required. The split is deliberate: "shorten this deadline" and
 * "declare this deadline the law" are different decisions.
 */
@ApiTags('sla')
@Controller('sla/policies')
export class SlaPolicyController {
  constructor(
    private readonly policies: SlaPolicyService,
    private readonly permissions: PermissionsService,
  ) {}

  @RequirePermissions('sla.policy.read')
  @Get()
  list(@Query() query: ListSlaPoliciesDto) {
    return this.policies.list({
      processType: query.processType,
      status: query.status,
    });
  }

  @RequirePermissions('sla.policy.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.policies.get(id);
  }

  @RequirePermissions('sla.policy.manage')
  @Post()
  create(
    @Body() dto: CreateSlaPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.create(dto, user);
  }

  /**
   * Edit a policy. Whether the caller may touch the source/citation fields is
   * resolved here and passed down, rather than the service reaching for a
   * guard — the same way `PermissionsGuard` resolves codes, so there is one
   * notion of "holds this permission".
   */
  @RequirePermissions('sla.policy.manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const granted = await this.permissions.getCodesForRoles(user.roles);
    return this.policies.update(
      id,
      dto,
      user,
      granted.has(REGULATORY_METADATA_PERMISSION),
    );
  }

  @RequirePermissions('sla.policy.manage')
  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.policies.activate(id, user);
  }

  @RequirePermissions('sla.policy.manage')
  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.policies.deactivate(id, user);
  }
}
