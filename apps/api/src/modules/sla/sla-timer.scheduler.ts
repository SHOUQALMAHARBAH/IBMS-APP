import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SlaTimerService } from './sla-timer.service';

/** Backlog A.8 — "a scheduled job that checks due timers frequently and
 * escalates" (ibms-brain/meta/lex/pdpl-sla-timers.md). Every 15 minutes is
 * frequent relative to the shortest SLA in the registry (1 hour — Material
 * incident Senior Management notification) without polling on every request.
 * `@nestjs/schedule`'s `CronExpression` enum has no 15-minute preset, hence
 * the raw cron string (same style as access-recertification.scheduler.ts's
 * quarterly cron). */
@Injectable()
export class SlaTimerScheduler {
  private readonly logger = new Logger(SlaTimerScheduler.name);

  constructor(private readonly slaTimer: SlaTimerService) {}

  @Cron('*/15 * * * *', { name: 'sla-timer-escalation-sweep' })
  async runSweep(): Promise<void> {
    // BREACHES ARE RECORDED FIRST, and separately from escalation.
    //
    // They are different facts: escalation fires on the RAW `dueAt` and
    // notifies somebody; a breach is the durable record that a deadline was
    // missed, measured against the PAUSE-ADJUSTED deadline. A paused clock is
    // not breached, and a timer whose escalation target is null still breaches.
    // Recording it as a stamped column means every reader gets the same answer
    // instead of each redoing the pause arithmetic and some getting it wrong.
    try {
      await this.slaTimer.recordBreaches();
    } catch (err) {
      this.logger.error(
        `SLA breach recording failed: ${(err as Error).message}`,
      );
    }

    try {
      const escalated = await this.slaTimer.runEscalationSweep();
      if (escalated.length > 0) {
        this.logger.log(
          `Escalated ${escalated.length} overdue SLA timer(s): ${escalated
            .map((t) => `${t.entityType}/${t.entityId} (${t.workflowName})`)
            .join(', ')}`,
        );
      }
    } catch (err) {
      // Never let a scheduled job crash the process — surface loudly; the
      // next sweep 15 minutes later will pick up whatever this run missed.
      this.logger.error(
        `SLA timer escalation sweep failed: ${(err as Error).message}`,
      );
    }
  }
}
