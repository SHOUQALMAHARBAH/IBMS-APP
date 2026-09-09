import { Module } from '@nestjs/common';
import { RenewalController } from './renewal.controller';
import { RenewalService } from './renewal.service';
import { RenewalScheduler } from './renewal.scheduler';
import { RenewalCaseRepository } from '../../repositories/renewal-case.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SlaModule } from '../sla/sla.module';
import { LossRatioModule } from '../loss-ratio/loss-ratio.module';

/**
 * Part 3.9 — Renewal Management. The gap `IMPROVEMENTS.md` §3.6 records as
 * blocking three already-shipped features (the per-`RenewalCase` `LossRatio`
 * upsert, Process 46's retention sweep, and the `renewal_workflow_start` SLA
 * timer, which was one of only two registry entries with no caller anywhere).
 *
 *   - AuditModule   -> AuditService (CREATE/UPDATE RenewalCase rows).
 *   - AuthModule    -> UserRepository (the scheduler resolves the system
 *                      service account to attribute its writes to).
 *   - SlaModule     -> SlaTimerService (`renewal_workflow_start`, backlog A.8).
 *   - LossRatioModule -> LossRatioService, so opening a case triggers the
 *                      Process 29 recompute that had no parent row to write
 *                      to until now. One-way: LossRatioModule imports nothing
 *                      from here, so no cycle.
 *   - WorkflowTransitionService comes from the @Global() WorkflowModule.
 *
 * No migration — `RenewalCase`, `RenewalStatus` and the
 * `WORKFLOW_TRANSITIONS.RenewalCase` map have all existed since the initial
 * domain-model migration and A.6 respectively, with no producer. Two new
 * seeded permissions (`renewal.read`, `renewal.manage`).
 */
@Module({
  imports: [AuditModule, AuthModule, SlaModule, LossRatioModule],
  controllers: [RenewalController],
  providers: [RenewalService, RenewalScheduler, RenewalCaseRepository],
  exports: [RenewalService],
})
export class RenewalModule {}
