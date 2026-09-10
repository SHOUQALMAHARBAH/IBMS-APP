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
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateSlaPolicyDto,
  ListSlaPoliciesDto,
  UpdateSlaPolicyDto,
  UpdateSlaPolicySourceDto,
} from './dto/sla-policy.dto';

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
  constructor(private readonly policies: SlaPolicyService) {}

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
   * Edit a policy's duration, calendar and escalation settings.
   *
   * Deliberately CANNOT touch the source/citation fields — those live on
   * `PATCH :id/source` behind their own permission. Making the permission
   * boundary a ROUTE boundary is how the rest of this codebase expresses
   * "these two things need different authority", and it keeps the check in the
   * guard rather than duplicated in a service argument.
   */
  @RequirePermissions('sla.policy.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.update(id, dto, user, false);
  }

  /**
   * Change what the system CLAIMS about this SLA's legal force.
   *
   * Separate from the edit above because "shorten this deadline" and "declare
   * this deadline legally required" are different decisions with different
   * consequences. `REGULATORY` still requires a named instrument — refused by
   * the service AND by a DB CHECK.
   */
  @RequirePermissions('sla.policy.regulatory')
  @Patch(':id/source')
  updateSource(
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicySourceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.update(id, dto, user, true);
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
