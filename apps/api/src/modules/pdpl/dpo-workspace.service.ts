import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import { DsrRepository } from '../../repositories/dsr.repository';
import { IncidentRepository } from '../../repositories/incident.repository';
import { DpiaScreeningRepository } from '../../repositories/dpia-screening.repository';
import { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import { CrossBorderTransferRepository } from '../../repositories/cross-border-transfer.repository';
import { deriveDsrView } from './dsr.config';
import { deriveIncidentReportView } from '../compliance-risk/incident.config';
import { deriveDpiaScreeningView } from './dpia-screening.config';
import { deriveLegalHoldView } from './legal-hold.config';
import { deriveCrossBorderTransferView } from './cross-border-transfer.config';
import {
  computeDaysUntilDue,
  type DpoWorkspaceSummary,
} from './dpo-workspace.config';

/**
 * These two are the DPO's working queues, and both are now filtered in SQL and
 * ordered oldest-first by their repositories (`findOpenQueue` /
 * `findOpenRegister`), so the cap bounds the number of OPEN items rather than
 * the number of rows scanned. That distinction is the whole point: under the
 * previous "N most recent, then filter in memory" shape an open item older
 * than the window was silently absent from a statutory-deadline queue, and the
 * first item to disappear was the oldest — the one nearest to breaching. The
 * caps stay because an unbounded read is still an unbounded read; what changed
 * is that hitting one now truncates the least urgent tail.
 *
 * There is deliberately no consent cap any more. `consentStatus` is three SQL
 * counts over every row (`countByConsentState`), not a tally of a capped page:
 * the table passed the old 1,000 limit and the figure had begun quietly
 * describing a subset.
 */
export const DSR_QUEUE_TAKE = 500;
export const INCIDENT_REGISTER_TAKE = 500;
const DPIA_SCAN_TAKE = 500;

/** The register shows only the most recent transfers, never the whole
 * history. Exported because a test asserting on this list has to know it is
 * capped: a "grew by one" assertion silently becomes unfalsifiable once the
 * table holds this many rows. */
export const CROSS_BORDER_RECENT_TAKE = 50;

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
      consentCounts,
      openDsrRows,
      openIncidentRows,
      dpiaRows,
      legalHoldRows,
      crossBorderRows,
    ] = await Promise.all([
      this.consentRecords.countByConsentState(),
      this.dsr.findOpenQueue(DSR_QUEUE_TAKE),
      this.incidents.findOpenRegister(INCIDENT_REGISTER_TAKE),
      this.dpia.findMany({ outcome: 'DPO_REVIEW_REQUIRED' }, DPIA_SCAN_TAKE),
      this.legalHolds.findMany({ active: true }),
      this.crossBorderTransfers.findMany({}, CROSS_BORDER_RECENT_TAKE),
    ]);

    // No `.filter` here any more — the repository already excluded the closed
    // requests in SQL. Filtering after a capped read is what let an old open
    // request fall out of the window unseen.
    const dsrQueue = openDsrRows.map((r) => {
      const view = deriveDsrView(r, now);
      return {
        ...view,
        daysUntilDue: computeDaysUntilDue(view.slaDueAt, now),
      };
    });

    const incidentRegister = openIncidentRows.map((r) =>
      deriveIncidentReportView(r, now),
    );

    const summary: DpoWorkspaceSummary = {
      generatedAt: now.toISOString(),
      consentStatus: consentCounts,
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
