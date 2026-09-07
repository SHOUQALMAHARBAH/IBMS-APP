import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WatchlistSyncService } from './watchlist-sync.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';

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
}
