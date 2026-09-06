import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import { DsrRepository } from '../../repositories/dsr.repository';
import { IncidentRepository } from '../../repositories/incident.repository';
import { DpiaScreeningRepository } from '../../repositories/dpia-screening.repository';
import { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import { CrossBorderTransferRepository } from '../../repositories/cross-border-transfer.repository';
import { deriveConsentView } from './consent.config';
import { deriveDsrView } from './dsr.config';
import { deriveIncidentReportView } from '../compliance-risk/incident.config';
import { deriveDpiaScreeningView } from './dpia-screening.config';
import { deriveLegalHoldView } from './legal-hold.config';
import { deriveCrossBorderTransferView } from './cross-border-transfer.config';
import {
  computeDaysUntilDue,
  summarizeConsentStatus,
  type DpoWorkspaceSummary,
} from './dpo-workspace.config';

const CONSENT_SCAN_TAKE = 1000;
const DSR_SCAN_TAKE = 500;
const INCIDENT_SCAN_TAKE = 500;
const DPIA_SCAN_TAKE = 500;
const CROSS_BORDER_RECENT_TAKE = 50;

const CLOSED_DSR_STATUS = 'CLOSED';
const CLOSED_INCIDENT_STATUS = 'CLOSED';

/** Backlog Part D §5.1 item #9 — see `dpo-workspace.config.ts`'s header
 * comment for the zero-cross-module-service-dependency shape. */
@Injectable()
export class DpoWorkspaceService {
  private readonly logger = new Logger(DpoWorkspaceService.name);

  constructor(
    private readonly consentRecords: ConsentRecordRepository,
    private readonly dsr: DsrRepository,
    private readonly incidents: IncidentRepository,
    private readonly dpia: DpiaScreeningRepository,
    private readonly legalHolds: LegalHoldRepository,
    private readonly crossBorderTransfers: CrossBorderTransferRepository,
    private readonly audit: AuditService,
  ) {}

  async getSummary(actorUserId: string): Promise<DpoWorkspaceSummary> {
    const now = new Date();

    const [
      consentRows,
      dsrRows,
      incidentRows,
      dpiaRows,
      legalHoldRows,
      crossBorderRows,
    ] = await Promise.all([
      this.consentRecords.findMany({}, CONSENT_SCAN_TAKE),
      this.dsr.findMany({}, DSR_SCAN_TAKE),
      this.incidents.findMany({}, INCIDENT_SCAN_TAKE),
      this.dpia.findMany({ outcome: 'DPO_REVIEW_REQUIRED' }, DPIA_SCAN_TAKE),
      this.legalHolds.findMany({ active: true }),
      this.crossBorderTransfers.findMany({}, CROSS_BORDER_RECENT_TAKE),
    ]);

    const dsrQueue = dsrRows
      .filter((r) => r.status !== CLOSED_DSR_STATUS)
      .map((r) => {
        const view = deriveDsrView(r, now);
        return {
          ...view,
          daysUntilDue: computeDaysUntilDue(view.slaDueAt, now),
        };
      });

    const incidentRegister = incidentRows
      .filter((r) => r.status !== CLOSED_INCIDENT_STATUS)
      .map((r) => deriveIncidentReportView(r, now));

    const summary: DpoWorkspaceSummary = {
      generatedAt: now.toISOString(),
      consentStatus: summarizeConsentStatus(
        consentRows.map((r) => deriveConsentView(r)),
      ),
      dsrQueue,
      incidentRegister,
      dpiaRegister: dpiaRows.map((r) => deriveDpiaScreeningView(r)),
      legalHoldRegister: legalHoldRows.map((r) => deriveLegalHoldView(r)),
      crossBorderTransferRegister: crossBorderRows.map((r) =>
        deriveCrossBorderTransferView(r),
      ),
    };

    await this.safeAudit(actorUserId, summary);

    return summary;
  }

  private async safeAudit(
    actorUserId: string,
    summary: DpoWorkspaceSummary,
  ): Promise<void> {
    try {
      await this.audit.record({
        userId: actorUserId,
        action: 'READ',
        entityType: 'DpoWorkspace',
        entityId: 'dpo-workspace',
        isSensitiveDataAccess: true,
        afterValue: {
          dsrQueueCount: summary.dsrQueue.length,
          incidentRegisterCount: summary.incidentRegister.length,
          dpiaRegisterCount: summary.dpiaRegister.length,
          legalHoldRegisterCount: summary.legalHoldRegister.length,
          crossBorderTransferRegisterCount:
            summary.crossBorderTransferRegister.length,
        },
      });
    } catch (err) {
      this.logger.error(
        `DpoWorkspace READ audit failed after the summary was computed: ${(err as Error).message}`,
      );
    }
  }
}
