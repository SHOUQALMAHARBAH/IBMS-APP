import { Module } from '@nestjs/common';
import { PolicyDashboardController } from './policy-dashboard.controller';
import { PolicyDashboardService } from './policy-dashboard.service';
import { PolicyDashboardRepository } from '../../repositories/policy-dashboard.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Part E — Dashboards & Management Reporting (Part 13), backlog Process
 * #64. The second of the six named dashboards: "active policies, expiring
 * policies (renewal window), new policies issued, cancelled policies and
 * cancellation reasons." See `policy-dashboard.config.ts` for the full
 * design note.
 *
 * `PolicyDashboardRepository` reads `Policy`/`Endorsement`/`Cancellation`
 * DIRECTLY — no cross-module service dependency, the #58 KPI Dashboard /
 * Sales Dashboard shape.
 *
 * No migration (a pure read over existing tables). No new permission —
 * `dashboard.policy.view` was pre-seeded ahead of time for exactly this
 * process.
 */
@Module({
  imports: [AuditModule],
  controllers: [PolicyDashboardController],
  providers: [PolicyDashboardService, PolicyDashboardRepository],
})
export class PolicyDashboardModule {}
