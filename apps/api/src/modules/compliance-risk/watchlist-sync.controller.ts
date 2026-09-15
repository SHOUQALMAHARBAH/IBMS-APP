import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WatchlistSyncService } from './watchlist-sync.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RollbackDatasetDto } from './dto/rollback-dataset.dto';

/**
 * Process 49 (backlog Part C #49, Domain F) — the sanctions/PEP list sync
 * job's on-demand trigger + status view. `sanctions-pep.screen`
 * (`[COMPLIANCE_OFFICER]`) gates both — the seeded permission's own
 * description, "Run recurring sanctions/PEP screening batches."
 */
@ApiTags('compliance-risk')
@Controller('watchlist-sync')
export class WatchlistSyncController {
  constructor(private readonly sync: WatchlistSyncService) {}

  /** Run the sync now (it is otherwise every 12 hours). */
  @RequirePermissions('sanctions-pep.screen')
  @Post('run')
  run() {
    return this.sync.runSync();
  }

  @RequirePermissions('sanctions-pep.screen')
  @Get('status')
  status() {
    return this.sync.findLatestSyncRuns();
  }

  /**
   * Part B §6 — every list generation, newest first, with the currently
   * PUBLISHED one marked. What an operator reads to answer "which list is
   * screening actually running against right now?"
   */
  @RequirePermissions('sanctions-pep.screen')
  @Get('datasets')
  datasets() {
    return this.sync.listDatasets();
  }

  /**
   * Part B §6 — restore an earlier generation.
   *
   * The most consequential manual override in this module: it decides the
   * newest available sanctions list is NOT the one screening runs against. It
   * requires a written reason, it is attributed, and it only works on a
   * generation whose rows are still present — one past the retention window is
   * still listed above but cannot be rolled back to, because there is nothing
   * left to screen against.
   */
  @RequirePermissions('sanctions-pep.screen')
  @Post('datasets/:id/rollback')
  rollback(
    @Param('id') id: string,
    @Body() dto: RollbackDatasetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sync.rollbackDataset(id, dto.reason, user.id);
  }
}
