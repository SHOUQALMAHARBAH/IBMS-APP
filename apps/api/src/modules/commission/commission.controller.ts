import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CommissionAgreementService } from './commission-agreement.service';
import { CommissionLedgerService } from './commission-ledger.service';
import { CreateCommissionAgreementDto } from './dto/create-commission-agreement.dto';
import { ListCommissionAgreementsQueryDto } from './dto/list-commission-agreements-query.dto';
import { CalculateCommissionDto } from './dto/calculate-commission.dto';
import { ListCommissionEntriesQueryDto } from './dto/list-commission-entries-query.dto';
import { RaiseCommissionOverrideDto } from './dto/raise-commission-override.dto';
import { SettleCommissionDto } from './dto/settle-commission.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 35 (backlog Part C #35, Domain D) — Commission Calculation.
 *
 * The governed rate table (`/commission/agreements`, `commission-rate.manage` /
 * Compliance + Manager) and the commission ledger (`/commission/entries`).
 * `POST /commission/entries` (`commission.calculate` / Finance) applies the
 * governed rate for a policy's insurer + line; `POST /commission/entries/:id/
 * override` (`commission-override.raise` / Finance) proposes a manual amount
 * with a mandatory reason, and `.../override/approve` (`commission-override
 * .approve` / Manager) is the separately-logged, distinct-actor approval.
 *
 * No `AuthModule` import — the global `PermissionsGuard` + `@CurrentUser`
 * cover it (same as `CrmModule` / `FinanceModule`). Frontend: the "Commission
 * rates" screen at apps/web/app/(app)/commission/ and the "Commission" block
 * on the opportunity detail screen.
 */
@ApiTags('commission')
@Controller('commission')
export class CommissionController {
  constructor(
    private readonly agreements: CommissionAgreementService,
    private readonly ledger: CommissionLedgerService,
  ) {}

  // --- governed rate table -------------------------------------------

  @RequirePermissions('commission-rate.manage')
  @Post('agreements')
  createAgreement(
    @Body() dto: CreateCommissionAgreementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agreements.create(dto, user.id);
  }

  @RequirePermissions('commission-rate.manage')
  @Get('agreements')
  listAgreements(@Query() query: ListCommissionAgreementsQueryDto) {
    return this.agreements.list(query);
  }

  /** The insurer id + name list for the "add agreement" form. */
  @RequirePermissions('commission-rate.manage')
  @Get('insurers')
  listInsurers() {
    return this.agreements.listInsurers();
  }

  // --- commission ledger --------------------------------------------

  @RequirePermissions('commission.calculate')
  @Post('entries')
  calculate(
    @Body() dto: CalculateCommissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ledger.calculate(dto, user.id);
  }

  @RequirePermissions('financial-report.view')
  @Get('entries')
  listEntries(@Query() query: ListCommissionEntriesQueryDto) {
    return this.ledger.list(query);
  }

  @RequirePermissions('financial-report.view')
  @Get('entries/:id')
  getEntry(@Param('id') id: string) {
    return this.ledger.get(id);
  }

  @RequirePermissions('commission-override.raise')
  @Post('entries/:id/override')
  raiseOverride(
    @Param('id') id: string,
    @Body() dto: RaiseCommissionOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ledger.raiseOverride(id, dto, user.id);
  }

  @RequirePermissions('commission-override.approve')
  @Post('entries/:id/override/approve')
  approveOverride(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ledger.approveOverride(id, user.id);
  }

  /** Process 36 — reconcile the entry against an insurer statement and mark it
   * `paid` (`commission.reconcile` / Finance). The `-> reversed` move is not an
   * endpoint: it is driven by a Process 22 cancellation / negative endorsement
   * minting a `CommissionReversal` for the policy. */
  @RequirePermissions('commission.reconcile')
  @Post('entries/:id/settle')
  settle(
    @Param('id') id: string,
    @Body() dto: SettleCommissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ledger.settle(id, dto, user.id);
  }
}
