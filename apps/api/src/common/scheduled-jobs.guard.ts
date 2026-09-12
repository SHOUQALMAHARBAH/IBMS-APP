import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

/**
 * Removes every wall-clock cron job at boot when `SCHEDULED_JOBS=disabled`.
 *
 * ## Why this exists
 *
 * The e2e suite boots the real `AppModule`, which registers
 * `ScheduleModule.forRoot()` and 19 `@Cron` jobs. They then fire **during test
 * runs, on wall-clock time**, against shared `db-test` state and — for the
 * watchlist sync — against live third-party endpoints.
 *
 * This is not hypothetical. A full suite run starting at 11:59:40 was broken by
 * `WATCHLIST_SYNC_CRON` (twice daily, at midnight and noon) firing at
 * 12:00:00, twenty seconds in: it performed a REAL sanctions-list download and
 * published a generation of ~1011 records, after which `watchlist-sync.e2e-spec.ts`'s 10-record fixture
 * was correctly refused by the plausibility floor. The assertion that failed
 * was a safety control working exactly as designed, on state a background job
 * had changed underneath it.
 *
 * The general form of the problem is worse than that one case: the SLA
 * escalation sweep runs every fifteen minutes, so it fires once or twice
 * inside any run longer than that, writing audit rows and escalating timers
 * while unrelated specs assert against the same tables. **A suite whose result
 * depends on what time of day it started is not telling you about your code.**
 *
 * ## Why it removes jobs rather than guarding each handler
 *
 * Nineteen handlers, each needing to remember the guard, is the shape that
 * produces a twentieth without one. Deleting them from the registry at boot
 * covers every job that exists now and every job added later, and cannot be
 * forgotten.
 *
 * `ScheduleModule` itself stays registered: `SchedulerRegistry`, `@Interval`
 * and `@Timeout` are still injectable, and anything that triggers a sweep
 * explicitly — every e2e that tests one does so through its endpoint — is
 * unaffected.
 *
 * ## It defaults to ON
 *
 * Only the literal value `disabled` turns jobs off, and `.env.test` sets it.
 * A missing or misspelt variable leaves production running its jobs, which is
 * the direction this has to fail: a deployment that silently stopped
 * re-screening customers against sanctions lists would be a compliance
 * failure, not an inconvenience.
 */
@Injectable()
export class ScheduledJobsGuard implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduledJobsGuard.name);

  constructor(private readonly registry: SchedulerRegistry) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SCHEDULED_JOBS !== 'disabled') return;

    const jobs = this.registry.getCronJobs();
    const names: string[] = [];
    for (const [name, job] of jobs) {
      // `stop()` is awaited because newer `cron` releases return a promise for
      // it; a job left mid-stop would still be deleted from the registry and
      // then fire with nothing tracking it.
      await job.stop();
      this.registry.deleteCronJob(name);
      names.push(name);
    }

    if (names.length > 0) {
      this.logger.warn(
        `SCHEDULED_JOBS=disabled — removed ${names.length} cron job(s) so they cannot fire mid-run: ${names.sort().join(', ')}`,
      );
    }
  }
}
