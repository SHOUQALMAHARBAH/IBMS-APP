import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FinancialReportService } from './financial-report.service';
import { FinancialReportQueryDto } from './dto/financial-report-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 40 (backlog Part C #40, Domain D) — Financial Reporting.
 * `GET /financial-report/summary?asOf=` returns the consolidated "Financial
 * Dashboard" (Part E dashboard D) summary: the AR / ageing totals (#33), the
 * insurer AP totals (#34), the commission income roll-up (earned / paid /
 * outstanding / reversed, totals + by insurer), and the profitability section
 * (every written policy grouped by line and by customer segment, with
 * `netPosition = premiumWritten − claimsPaid − commissionEarned`).
 *
 * Book-wide read — `financial-report.view` is `[FINANCE_COLLECTIONS_OFFICER,
 * BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]` (the same
 * perm `GET /commission/entries` already uses). No `AuthModule` import — the
 * global `PermissionsGuard` / `@CurrentUser` cover it (same as the rest of
 * `FinanceModule`). The profitability section aggregates HIGHLY_CONFIDENTIAL
 * `Claim` rows, so the service writes a best-effort `READ` audit row (counts
 * only). Frontend: the "Financial report" screen at
 * apps/web/app/(app)/financial-report/.
 */
@ApiTags('finance')
@Controller('financial-report')
export class FinancialReportController {
  constructor(private readonly financialReport: FinancialReportService) {}

  @RequirePermissions('financial-report.view')
  @Get('summary')
  summary(
    @Query() query: FinancialReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financialReport.summary({ asOf: query.asOf }, user.id);
  }
}
