import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrmService } from './crm.service';
import { LogInteractionDto } from './dto/log-interaction.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 10 — Relationship Management (CRM) (backlog Part C #10). Every
 * customer touchpoint is logged as an `Interaction`; `GET 360-view`
 * aggregates the interaction log with the customer's policies, claims and
 * complaints into one reverse-chronological timeline (the Policy / Claim /
 * Complaint modules are not built yet, so those collections are empty until
 * Domains B / C / E land — see crm.service.ts). Routes are nested under
 * `customers/:customerId`, alongside `ubos` / `documents`. Frontend:
 * apps/web/app/(app)/crm/. */
@ApiTags('crm')
@Controller('customers/:customerId')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  /** Log a meeting / call / email / WhatsApp / visit / proposal / renewal /
   * claim / complaint touchpoint. Gated by `interaction.log` alone — NOT by
   * customer ownership (cross-functional staff log against customers they do
   * not own). */
  @RequirePermissions('interaction.log')
  @Post('interactions')
  logInteraction(
    @Param('customerId') customerId: string,
    @Body() dto: LogInteractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crm.logInteraction(customerId, dto, user);
  }

  @RequirePermissions('customer.360-view.read')
  @Get('interactions')
  listInteractions(
    @Param('customerId') customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crm.listInteractions(customerId, user);
  }

  @RequirePermissions('customer.360-view.read')
  @Get('360-view')
  get360View(
    @Param('customerId') customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crm.get360View(customerId, user);
  }
}
