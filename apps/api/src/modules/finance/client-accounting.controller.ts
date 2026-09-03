import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClientAccountingService } from './client-accounting.service';
import { ReceivablesAgeingQueryDto } from './dto/receivables-ageing-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';

/**
 * Process 33 (backlog Part C #33, Domain D) — Client Accounting.
 * `GET /client-accounting/ageing?customerId=&asOf=` returns the
 * accounts-receivable / ageing report: one row per customer with an
 * outstanding balance, split into 30 / 60 / 90-day ageing buckets, ordered
 * worst-first, plus a totals row pooling every outstanding invoice in scope.
 *
 * Book-wide read — `client-accounting.read` is `[FINANCE_COLLECTIONS_OFFICER,
 * BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]` (the
 * same permission #31's `GET /invoices` uses); the optional `customerId`
 * narrows the report to one client. No `AuthModule` import — the global
 * `PermissionsGuard` covers it (same as `CrmModule` / `LossRatioModule`).
 * Frontend: the "Client accounting" screen at
 * apps/web/app/(app)/client-accounting/.
 */
@ApiTags('finance')
@Controller('client-accounting')
export class ClientAccountingController {
  constructor(private readonly clientAccounting: ClientAccountingService) {}

  @RequirePermissions('client-accounting.read')
  @Get('ageing')
  ageing(@Query() query: ReceivablesAgeingQueryDto) {
    return this.clientAccounting.receivablesAgeing({
      customerId: query.customerId,
      asOf: query.asOf,
    });
  }
}
