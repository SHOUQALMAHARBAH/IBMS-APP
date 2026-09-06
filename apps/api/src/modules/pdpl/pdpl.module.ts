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
import { CrossBorderTransferController } from './cross-border-transfer.controller';
import { CrossBorderTransferService } from './cross-border-transfer.service';
import { CrossBorderTransferRepository } from '../../repositories/cross-border-transfer.repository';
import { DataSharingApprovalController } from './data-sharing-approval.controller';
import { DataSharingApprovalService } from './data-sharing-approval.service';
import { DataSharingApprovalRepository } from '../../repositories/data-sharing-approval.repository';
import { DpiaScreeningController } from './dpia-screening.controller';
import { DpiaScreeningService } from './dpia-screening.service';
import { DpiaScreeningRepository } from '../../repositories/dpia-screening.repository';
import { PrivacyNoticeController } from './privacy-notice.controller';
import { PrivacyNoticeService } from './privacy-notice.service';
import { PrivacyNoticeRepository } from '../../repositories/privacy-notice.repository';
import { RopaEntryController } from './ropa-entry.controller';
import { RopaEntryService } from './ropa-entry.service';
import { RopaEntryRepository } from '../../repositories/ropa-entry.repository';
import { DpoWorkspaceController } from './dpo-workspace.controller';
import { DpoWorkspaceService } from './dpo-workspace.service';
import { VendorRepository } from '../../repositories/vendor.repository';
import { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import { IncidentRepository } from '../../repositories/incident.repository';
import { AuditModule } from '../audit/audit.module';
import { SlaModule } from '../sla/sla.module';

/**
 * PDPL / PCMS foundations (backlog Part D, `IMPROVEMENTS.md` §5.1; the
 * backlog bundles all of Part D under Process #52 "Data Protection
 * Compliance"). Opened with M03 — Consent Management; M04 — Data Subject
 * Request Management; M06 — Retention & Secure Disposal (three
 * sub-systems: schedule/legal-hold/disposal-batch). See
 * `ibms-brain/meta/context/consent-management.md`,
 * `data-subject-requests.md`, `data-retention-and-disposal.md` for those.
 *
 * This build completes Part D's remaining six items:
 *
 *   - Cross-Border Transfer (`CrossBorderTransferController`/`Service`,
 *     Part 6.2 — this backlog item names no single M01-M12 module; M05 is
 *     already "Data Collection & Access Governance," a different system —
 *     see `cross-border-transfer.config.ts`'s header comment):
 *     `cross-border-transfer.approve` (DPO-only) gates the whole surface;
 *     creating a record IS approving it.
 *   - M08 — Third Parties & Data Sharing (`DataSharingApprovalController`/
 *     `Service`): the maker/checker pair this codebase's covered-pairs
 *     table already named; wires backlog #71's previously-uncalled
 *     `computeDataShareReadiness()` live for the first time — hence the
 *     cross-module `VendorRepository`/`DataProcessingAgreementRepository`
 *     imports (both `supporting-operations`, injected directly — the
 *     zero-cross-module-service-dependency pattern).
 *   - M10 — DPIA Screening (`DpiaScreeningController`/`Service`):
 *     `dpia.review` (DPO-only) gates the whole surface, including
 *     submission — `outcome` isn't routed through `WorkflowTransitionService`
 *     since it isn't a column literally named `status`
 *     (`dpia-screening.config.ts`'s header comment).
 *   - Notices (`PrivacyNoticeController`/`Service`): creation IS
 *     publishing, append-only versioning (a real `@@unique` constraint,
 *     migration `20260915120000`).
 *   - Records of Processing Activities (`RopaEntryController`/`Service`):
 *     plain mutable CRUD + an `EXPORT`-audited register dump.
 *   - The DPO Workspace screen (`DpoWorkspaceController`/`Service`):
 *     aggregates the six registers above — a NEW `dpo-workspace.view`
 *     permission (a genuine gap, no code pre-seeded one), plus one more
 *     cross-module repository import, `IncidentRepository`
 *     (`compliance-risk`), for the incident/breach register.
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE / READ / APPROVE /
 *     REJECT / EXPORT audit rows)
 *   - SlaModule   -> SlaTimerService — `data_sharing_decision` (3 business
 *     days / 1 for the regulatory-channel fast track) and `dpia_review` (5
 *     business days) are this build's first real callers.
 *
 * `WorkflowTransitionService` needs no import here: none of the six new
 * entities have a column literally named `status` (`DpiaScreening.outcome`
 * is status-SHAPED but not status-NAMED — see `dpia-screening.config.ts`).
 *
 * `LegalHoldRepository`/`VendorRepository`/`DataProcessingAgreementRepository`/
 * `IncidentRepository` are all injected directly into services that need
 * them (`DisposalBatchService`, `DataSharingApprovalService`,
 * `DpoWorkspaceService`) — none of them leave this providers array, so
 * none of this is a cross-module coupling violation.
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [
    ConsentController,
    DsrController,
    RetentionScheduleController,
    LegalHoldController,
    DisposalBatchController,
    CrossBorderTransferController,
    DataSharingApprovalController,
    DpiaScreeningController,
    PrivacyNoticeController,
    RopaEntryController,
    DpoWorkspaceController,
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
    CrossBorderTransferService,
    CrossBorderTransferRepository,
    DataSharingApprovalService,
    DataSharingApprovalRepository,
    DpiaScreeningService,
    DpiaScreeningRepository,
    PrivacyNoticeService,
    PrivacyNoticeRepository,
    RopaEntryService,
    RopaEntryRepository,
    DpoWorkspaceService,
    VendorRepository,
    DataProcessingAgreementRepository,
    IncidentRepository,
  ],
})
export class PdplModule {}
