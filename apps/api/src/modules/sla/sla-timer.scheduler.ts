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
