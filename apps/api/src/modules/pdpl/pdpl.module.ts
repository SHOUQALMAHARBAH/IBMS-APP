import { Module } from '@nestjs/common';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import { DsrController } from './dsr.controller';
import { DsrService } from './dsr.service';
import { DsrRepository } from '../../repositories/dsr.repository';
import { RetentionScheduleController } from './retention-schedule.controller';
import { RetentionScheduleService } from './retention-schedule.service';
import { RetentionScheduleRepository } from '../../repositories/retention-schedule.repository';
import { LegalHoldController } from './legal-hold.controller';
import { LegalHoldService } from './legal-hold.service';
import { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import { DisposalBatchController } from './disposal-batch.controller';
import { DisposalBatchService } from './disposal-batch.service';
import { DisposalBatchRepository } from '../../repositories/disposal-batch.repository';
import { AuditModule } from '../audit/audit.module';
import { SlaModule } from '../sla/sla.module';

/**
 * PDPL / PCMS foundations (backlog Part D, `IMPROVEMENTS.md` §5.1; the
 * backlog bundles all of Part D under Process #52 "Data Protection
 * Compliance"). Opened with M03 — Consent Management
 * (`ibms-brain/meta/context/pcms-privacy-modules.md`'s M01-M12 map);
 * `ConsentController` / `ConsentService` own the `ConsentRecord` capture +
 * two-step withdrawal flow.
 *
 * M04 — Data Subject Request Management (`DsrController` / `DsrService`):
 * the Access/Correction/Deletion/Objection workflow, `dsr.config.ts`'s
 * header comment.
 *
 * M06 — Data Retention & Secure Disposal: three sub-systems, three
 * controllers. `RetentionScheduleController`/`Service` own the retention-
 * period table itself. `LegalHoldController`/`Service` own placing/
 * reviewing/releasing a hold (the 6-month review SLA). `DisposalBatchController`/
 * `Service` own the dual-control `NOMINATED -> MANAGER_APPROVED ->
 * DPO_APPROVED -> EXECUTED -> CLOSED` workflow — `disposal-batch.config.ts`'s
 * header comment, including the Legal-Hold-exclusion re-check at every
 * step. The remaining six PCMS systems (M07 Vendor Risk — partially
 * covered by backlog #71, M08 Data Sharing, M09 Incident — built as Part C
 * #55, M10 DPIA, notices, RoPA, and the DPO Workspace dashboard) are not
 * built yet — see `ibms-brain/meta/context/consent-management.md` (M03),
 * `ibms-brain/meta/context/data-subject-requests.md` (M04),
 * `ibms-brain/meta/context/data-retention-and-disposal.md` (M06), and
 * `ibms-brain/meta/context/pcms-privacy-modules.md` (the M01-M12 map).
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE / READ audit rows)
 *   - SlaModule   -> SlaTimerService (the generic escalation engine —
 *     `consent_withdrawal` 2 business days; `dsr_access_deletion` 15,
 *     `dsr_correction_objection` 10 (DPO-then-General-Manager two-stage
 *     escalation); `legal_hold_necessity_review` 6 months
 *     (DPO_AND_LEGAL_COUNSEL); `disposal_batch_execution` 30 calendar days
 *     from DPO approval).
 *
 * `WorkflowTransitionService` (`DataSubjectRequest`'s and `DisposalBatch`'s
 * own state machines — `ConsentRecord`/`RetentionScheduleItem`/`LegalHold`
 * have no `status` field at all, so those three never need it) needs no
 * import here at all: `WorkflowModule`, like `SlaModule`, is `@Global()`
 * and already imported directly by `AppModule` — this module's own
 * `SlaModule` import is a harmless, pre-existing redundancy from the M03
 * build, not a requirement to copy.
 *
 * `LegalHoldRepository` is injected directly into `DisposalBatchService`
 * (both live in THIS module) for the exclusion check — no cross-module
 * coupling, since it never leaves `PdplModule`.
 *
 * The global `PermissionsGuard` / `@CurrentUser` cover every controller;
 * `AuthModule` is not imported here (no scheduler in this module needs the
 * system service account — contrast `CustomerServiceModule`'s retention
 * sweep).
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [
    ConsentController,
    DsrController,
    RetentionScheduleController,
    LegalHoldController,
    DisposalBatchController,
  ],
  providers: [
    ConsentService,
    ConsentRecordRepository,
    DsrService,
    DsrRepository,
    RetentionScheduleService,
    RetentionScheduleRepository,
    LegalHoldService,
    LegalHoldRepository,
    DisposalBatchService,
    DisposalBatchRepository,
  ],
})
export class PdplModule {}
