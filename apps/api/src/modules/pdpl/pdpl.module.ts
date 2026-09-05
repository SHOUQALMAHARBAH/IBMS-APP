import { Module } from '@nestjs/common';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import { DsrController } from './dsr.controller';
import { DsrService } from './dsr.service';
import { DsrRepository } from '../../repositories/dsr.repository';
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
 * header comment. The other seven PCMS systems (M06 Retention & Disposal,
 * M07 Vendor Risk, M08 Data Sharing, M09 Incident, M10 DPIA, notices, RoPA,
 * and the DPO Workspace dashboard) are not built yet — see
 * `ibms-brain/meta/context/consent-management.md` (M03),
 * `ibms-brain/meta/context/data-subject-requests.md` (M04), and
 * `ibms-brain/meta/context/pcms-privacy-modules.md` (the M01-M12 map).
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE / READ audit rows)
 *   - SlaModule   -> SlaTimerService (the generic escalation engine —
 *     `consent_withdrawal` 2 business days; `dsr_access_deletion` 15,
 *     `dsr_correction_objection` 10, both with the DPO-then-General-Manager
 *     two-stage escalation).
 *
 * `WorkflowTransitionService` (`DataSubjectRequest`'s `RECEIVED -> ... ->
 * CLOSED` state machine — `ConsentRecord` has no `status` at all, so M03
 * alone never needed it) needs no import here at all: `WorkflowModule`, like
 * `SlaModule`, is `@Global()` and already imported directly by `AppModule` —
 * this module's own `SlaModule` import is a harmless, pre-existing
 * redundancy from the M03 build, not a requirement to copy.
 *
 * The global `PermissionsGuard` / `@CurrentUser` cover both controllers;
 * `AuthModule` is not imported here (no scheduler in this module needs the
 * system service account — contrast `CustomerServiceModule`'s retention
 * sweep).
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [ConsentController, DsrController],
  providers: [
    ConsentService,
    ConsentRecordRepository,
    DsrService,
    DsrRepository,
  ],
})
export class PdplModule {}
