import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InsurerAccountingService } from './insurer-accounting.service';
import { InsurerPayablesQueryDto } from './dto/insurer-payables-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';

/**
 * Process 34 (backlog Part C #34, Domain D) — Insurer Accounting.
 * `GET /insurer-accounting/payables?insurerId=&asOf=` returns the
 * accounts-payable / remittance-obligations report: one row per insurer with
 * the net premium the broker has collected but not yet remitted
 * (`outstandingAmount`), the total already remitted (`remittedAmount`), and how
 * long the oldest unremitted obligation has been outstanding — ordered
 * worst-first, plus a totals row.
 *
 * Book-wide read — `insurer-accounting.read` is `[FINANCE_COLLECTIONS_OFFICER,
 * BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]` (the
 * insurer-side mirror of #33's `client-accounting.read`); the optional
 * `insurerId` narrows to one insurer. No `AuthModule` import — the global
 * `PermissionsGuard` covers it (same as #33). Frontend: the "Insurer
 * accounting" screen at apps/web/app/(app)/insurer-accounting/.
 */
@ApiTags('finance')
@Controller('insurer-accounting')
export class InsurerAccountingController {
  constructor(private readonly insurerAccounting: InsurerAccountingService) {}

  @RequirePermissions('insurer-accounting.read')
  @Get('payables')
  payables(@Query() query: InsurerPayablesQueryDto) {
    return this.insurerAccounting.payables({
      insurerId: query.insurerId,
      asOf: query.asOf,
    });
  }
}
