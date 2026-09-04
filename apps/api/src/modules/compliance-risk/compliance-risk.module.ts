import { Module } from '@nestjs/common';
import { TransactionMonitoringController } from './transaction-monitoring.controller';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { TransactionMonitoringAlertRepository } from '../../repositories/transaction-monitoring-alert.repository';
import { TransactionMonitoringSweepScheduler } from './transaction-monitoring-sweep.scheduler';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Domain F — Compliance & Risk (backlog Part C #47–57). Opens with Process
 * 48, AML/CFT Transaction Monitoring (`TransactionMonitoringService` +
 * `TransactionMonitoringSweepScheduler`): a nightly + on-demand detection
 * sweep over `Receipt`/`Cancellation`/`Refund` for four unusual-payment
 * patterns, plus a two-step suspicious-activity escalation path
 * (`escalate` then `report-to-authority`). Process 47 (KYC) needed no
 * separate build — it is fully covered by Part C #3–4's `KycService` /
 * `ScreeningService`; see `ibms-brain/meta/context/transaction-monitoring.md`.
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE rows)
 *   - AuthModule  -> UserRepository (the sweep resolves the system service
 *     account, same as every other scheduler)
 *
 * `TransactionMonitoringAlert.status` is a plain string, not a
 * `WorkflowTransitionService` entity — `WorkflowModule` is not needed here.
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TransactionMonitoringController],
  providers: [
    TransactionMonitoringService,
    TransactionMonitoringAlertRepository,
    TransactionMonitoringSweepScheduler,
  ],
})
export class ComplianceRiskModule {}
