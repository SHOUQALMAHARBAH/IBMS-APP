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
import { BrokerLicenseController } from './broker-license.controller';
import { BrokerLicenseService } from './broker-license.service';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { ComplianceCalendarController } from './compliance-calendar.controller';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { ComplianceCalendarRepository } from '../../repositories/compliance-calendar.repository';
import { RiskRegisterController } from './risk-register.controller';
import { RiskRegisterService } from './risk-register.service';
import { RiskRegisterRepository } from '../../repositories/risk-register.repository';
import { PiPolicyController } from './pi-policy.controller';
import { PiPolicyService } from './pi-policy.service';
import { PiPolicyRepository } from '../../repositories/pi-policy.repository';
import { PiRiskEventController } from './pi-risk-event.controller';
import { PiRiskEventService } from './pi-risk-event.service';
import { PiRiskEventRepository } from '../../repositories/pi-risk-event.repository';
import { IncidentController } from './incident.controller';
import { IncidentService } from './incident.service';
import { IncidentRepository } from '../../repositories/incident.repository';
import { InternalAuditFindingController } from './internal-audit-finding.controller';
import { InternalAuditFindingService } from './internal-audit-finding.service';
import { InternalAuditFindingRepository } from '../../repositories/internal-audit-finding.repository';
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
 * Process 51, Regulatory Compliance (`BrokerLicenseService` +
 * `ComplianceCalendarService`): the broker's own CBJ license record (a
 * singleton — see `broker-license.config.ts`'s `BROKER_LICENSE_SINGLETON_ID`)
 * and a compliance calendar of regulatory obligations. `BrokerLicense
 * Repository` is ALSO provided directly by `PolicyModule`
 * (`PolicyService.place()` reads it to block new business once the license
 * has lapsed — backlog Part C #51's first checkbox) — the same deliberate
 * duplication-over-cross-import shape as `WatchlistEntryRepository` above.
 * No scheduler here: the lapsed check is a pure, live recompute
 * (`isBrokerLicenseCurrentlyLapsed`) shared by the gate and the read view,
 * not a stored flag a background sweep needs to keep in sync — see that
 * function's own comment for why (the #16 `@code-reviewer` MAJOR lesson).
 *
 * Process 53-54, Operational & Professional Indemnity Risk
 * (`RiskRegisterService` + `PiPolicyService` + `PiRiskEventService`): a
 * generic risk register over the five non-PI categories the source names
 * (operational/cyber/financial/compliance/reputational — PI gets its own
 * deeper table, see `risk-register.config.ts`), the broker's own PI policy
 * record (NOT a fixed-id singleton like `BrokerLicense` — "current" is the
 * row with the furthest-out `expiresAt`, see `pi-policy.config.ts`), and the
 * PI risk events a Policy Checking discrepancy already auto-logs (Process
 * 20/54) — this gives those rows their first read surface plus a manual log
 * path. `PiPolicyRepository` is ALSO provided directly by `PolicyModule`
 * (`PolicyCheckingRepository.findLatestPiPolicyId`'s discrepancy auto-link)
 * — the same deliberate duplication-over-cross-import shape as
 * `BrokerLicenseRepository` above.
 *
 * Process 55, Incident Management (`IncidentService`): the unified security
 * + personal-data breach workflow — a strictly linear, pre-existing
 * `WORKFLOW_TRANSITIONS.IncidentReport` chain (Reported -> Contained ->
 * Impact Assessed -> Classified -> Notified -> Recovered -> Closed) this
 * module is the first real consumer of. Material classification is a
 * maker/checker pair (DPO classifies, Executive Management co-signs) role-
 * checked inside the service beyond the coarse `incident.classify`
 * permission both roles share, backed by a new CHECK constraint (migration
 * `20260906120000`) on the two pre-existing columns. The backlog's "senior
 * management notification (job)" checkbox deliberately has NO bespoke
 * scheduler — it reuses the pre-existing generic `SlaTimerScheduler`
 * (runs every 15 minutes, backlog A.8), which already lists `IncidentReport`
 * in `SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES`. This model is ALSO Part D's M09
 * (Incident & Breach Management) — see
 * `ibms-brain/meta/context/incident-management.md`.
 *
 * Process 57, Internal Audit (`InternalAuditFindingService`) — closes
 * Domain F. `InternalAuditFinding` (core schema) is the exact same bare
 * "generic register" shape as `RiskRegisterItem`, one model up in the same
 * file — no maker/checker, `status`: plain string `open -> closed`.
 * `internal-audit.record` (Compliance) and `internal-audit.close`
 * (Compliance + Manager) are two DISTINCT permissions, not a maker/checker
 * pair. See `ibms-brain/meta/context/internal-audit-and-external-auditor-
 * access.md` — this process also builds #57's second checkbox, the
 * External Auditor's time-boxed read-only access, in its own separate
 * `AuditTrailModule` (a cross-cutting reader over `AuditLogEntry`, not
 * owned by any one business module, the `SlaDashboardModule` shape).
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE rows)
 *   - AuthModule  -> UserRepository (the sweep resolves the system service
 *     account, same as every other scheduler)
 *
 * `TransactionMonitoringAlert.status` is a plain string, not a
 * `WorkflowTransitionService` entity — `WorkflowModule` is not needed here
 * as an explicit import (it, like `SlaModule`, is `@Global()` — `IncidentReport`
 * IS a workflow entity and uses it, without needing it listed below).
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [
    TransactionMonitoringController,
    WatchlistSyncController,
    BrokerLicenseController,
    ComplianceCalendarController,
    RiskRegisterController,
    PiPolicyController,
    PiRiskEventController,
    IncidentController,
    InternalAuditFindingController,
  ],
  providers: [
    TransactionMonitoringService,
    TransactionMonitoringAlertRepository,
    TransactionMonitoringSweepScheduler,
    WatchlistSyncService,
    WatchlistSyncScheduler,
    WatchlistEntryRepository,
    OfacSdnFetcher,
    UnConsolidatedFetcher,
    BrokerLicenseService,
    BrokerLicenseRepository,
    ComplianceCalendarService,
    ComplianceCalendarRepository,
    RiskRegisterService,
    RiskRegisterRepository,
    PiPolicyService,
    PiPolicyRepository,
    PiRiskEventService,
    PiRiskEventRepository,
    IncidentService,
    IncidentRepository,
    InternalAuditFindingService,
    InternalAuditFindingRepository,
  ],
})
export class ComplianceRiskModule {}
