import { Module } from '@nestjs/common';
import { TransactionMonitoringController } from './transaction-monitoring.controller';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { TransactionMonitoringAlertRepository } from '../../repositories/transaction-monitoring-alert.repository';
import { TransactionMonitoringSweepScheduler } from './transaction-monitoring-sweep.scheduler';
import { WatchlistSyncController } from './watchlist-sync.controller';
import { WatchlistSyncService } from './watchlist-sync.service';
import { WatchlistSyncScheduler } from './watchlist-sync.scheduler';
import { OfacSdnFetcher, UnConsolidatedFetcher } from './watchlist-fetchers';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
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
 * Process 49, Sanctions & PEP Screening (`WatchlistSyncService` +
 * `WatchlistSyncScheduler`): syncs two free public sanctions lists (OFAC
 * SDN, UN Consolidated) into `WatchlistEntry` every 12 hours (or on
 * demand), which `CustomerModule`'s `ScreeningService` matches customer/UBO
 * names against — see
 * `ibms-brain/meta/context/sanctions-pep-screening.md`. `WatchlistEntry
 * Repository` is ALSO provided directly by `CustomerModule` (a stateless
 * `PrismaService` wrapper, safe to instantiate twice) rather than exported/
 * imported across modules, to avoid a `ComplianceRiskModule` <->
 * `CustomerModule` dependency in either direction.
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
  controllers: [TransactionMonitoringController, WatchlistSyncController],
  providers: [
    TransactionMonitoringService,
    TransactionMonitoringAlertRepository,
    TransactionMonitoringSweepScheduler,
    WatchlistSyncService,
    WatchlistSyncScheduler,
    WatchlistEntryRepository,
    OfacSdnFetcher,
    UnConsolidatedFetcher,
  ],
})
export class ComplianceRiskModule {}
