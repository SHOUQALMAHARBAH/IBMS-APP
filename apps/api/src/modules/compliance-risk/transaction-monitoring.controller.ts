import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { CreateTransactionMonitoringAlertDto } from './dto/create-transaction-monitoring-alert.dto';
import { ListTransactionMonitoringAlertsQueryDto } from './dto/list-transaction-monitoring-alerts-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 48 (backlog Part C #48, Domain F) — AML/CFT Transaction
 * Monitoring. `aml.monitor` gates logging/detecting/reading/closing;
 * `aml.escalate` gates the two-step suspicious-activity escalation path
 * (`escalate` then `report-to-authority`) — both seeded `[COMPLIANCE_OFFICER]`
 * only, but kept as distinct permissions since the seed pre-dates this
 * module and clearly means to separate the two.
 */
@ApiTags('compliance-risk')
@Controller('transaction-monitoring-alerts')
export class TransactionMonitoringController {
  constructor(private readonly monitoring: TransactionMonitoringService) {}

  @RequirePermissions('aml.monitor')
  @Post()
  create(
    @Body() dto: CreateTransactionMonitoringAlertDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.monitoring.create(dto, user.id);
  }

  /** Run the pattern-detection sweep now (it is otherwise nightly). Declared
   * before the `:id` routes so `detect` is never read as an alert id. */
  @RequirePermissions('aml.monitor')
  @Post('detect')
  detect(@CurrentUser() user: AuthenticatedUser) {
    return this.monitoring.runSweep(user.id);
  }

  @RequirePermissions('aml.monitor')
  @Get()
  list(
    @Query() query: ListTransactionMonitoringAlertsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.monitoring.list(query, user.id);
  }

  @RequirePermissions('aml.monitor')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.monitoring.get(id, user.id);
  }

  @RequirePermissions('aml.escalate')
  @Post(':id/escalate')
  escalate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.monitoring.escalate(id, user.id);
  }

  @RequirePermissions('aml.escalate')
  @Post(':id/report-to-authority')
  reportToAuthority(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.monitoring.reportToAuthority(id, user.id);
  }

  @RequirePermissions('aml.monitor')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.monitoring.close(id, user.id);
  }
}
