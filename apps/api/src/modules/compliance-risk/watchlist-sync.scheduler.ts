import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  WatchlistSyncService,
  type WatchlistSyncOutcome,
} from './watchlist-sync.service';
import { WATCHLIST_SYNC_CRON } from './watchlist-sync.config';

/**
 * Process 49 — "a recurring batch against updated lists" (backlog Part C
 * #49's checkbox). The free public sanctions lists this module consumes
 * refresh roughly every 12 hours; syncing on the same cadence keeps the
 * local cache current without polling a source that has nothing new.
 */
@Injectable()
export class WatchlistSyncScheduler {
  private readonly logger = new Logger(WatchlistSyncScheduler.name);

  constructor(private readonly sync: WatchlistSyncService) {}

  @Cron(WATCHLIST_SYNC_CRON, { name: 'watchlist-sync' })
  async runSync(): Promise<void> {
    let outcomes: WatchlistSyncOutcome[];
    try {
      outcomes = await this.sync.runSync();
    } catch (err) {
      this.logger.error(
        `Watchlist sync tick failed: ${(err as Error).message}`,
      );
      return;
    }
    for (const outcome of outcomes) {
      if (outcome.status === 'failed') {
        this.logger.error(
          `Watchlist sync (${outcome.source}) failed: ${outcome.errorMessage}`,
        );
      }
    }
  }
}
