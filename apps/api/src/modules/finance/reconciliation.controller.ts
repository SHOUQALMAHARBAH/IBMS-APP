import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { DetectReconciliationDto } from './dto/detect-reconciliation.dto';
import { ResolveReconciliationDto } from './dto/resolve-reconciliation.dto';
import { ListReconciliationExceptionsQueryDto } from './dto/list-reconciliation-exceptions-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 39 (backlog Part C #39, Domain D) — Bank Reconciliation. Detect a
 * variance between an insurer's statement and the broker's record (raises a
 * `ReconciliationException` per non-zero variance, never a silent write-off),
 * then investigate and close it. `reconciliation-exception.investigate`
 * (Finance) covers detect + the `open → investigating` claim + the reads;
 * `reconciliation-exception.resolve` (Finance, Manager) closes it. No
 * `AuthModule` import — the global `PermissionsGuard` + `@CurrentUser` cover it
 * (same as the rest of `FinanceModule`).
 */
@ApiTags('finance')
@Controller('reconciliation-exceptions')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @RequirePermissions('reconciliation-exception.investigate')
  @Post('detect')
  detect(
    @Body() dto: DetectReconciliationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.detect(dto, user.id);
  }

  @RequirePermissions('reconciliation-exception.investigate')
  @Get()
  list(@Query() query: ListReconciliationExceptionsQueryDto) {
    return this.reconciliation.list(query);
  }

  @RequirePermissions('reconciliation-exception.investigate')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.reconciliation.get(id);
  }

  @RequirePermissions('reconciliation-exception.investigate')
  @Post(':id/investigate')
  investigate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.investigate(id, user.id);
  }

  @RequirePermissions('reconciliation-exception.resolve')
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReconciliationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reconciliation.resolve(id, dto, user.id);
  }
}
