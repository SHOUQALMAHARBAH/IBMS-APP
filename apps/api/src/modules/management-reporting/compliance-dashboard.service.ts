import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { ComplianceDashboardRepository } from '../../repositories/compliance-dashboard.repository';
import { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import {
  buildComplianceDashboardSummary,
  type ComplianceDashboardSummary,
} from './compliance-dashboard.config';
import type { ComplianceDashboardQueryDto } from './dto/compliance-dashboard-query.dto';

@Injectable()
export class ComplianceDashboardService {
  private readonly logger = new Logger(ComplianceDashboardService.name);

  constructor(
    private readonly repo: ComplianceDashboardRepository,
    private readonly auditTrail: AuditTrailRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(
    query: ComplianceDashboardQueryDto,
    actorUserId: string,
  ): Promise<ComplianceDashboardSummary> {
    const now = new Date();
    const ownerUserIds = query.branchId
      ? (await this.repo.findUserIdsInBranch(query.branchId)).map((u) => u.id)
      : undefined;
    const filters = { ownerUserIds };

    const [
      kycByStatus,
      complaintsByStatus,
      complaintsByCategory,
      amlOpenByPatternType,
      lastScanRows,
      regulatoryFilingRows,
      dsrByStatus,
      incidentByStatus,
      dpiaByOutcome,
      dpiaPendingReviewCount,
    ] = await Promise.all([
      this.repo.countKycByStatus(filters),
      this.repo.countComplaintsByStatus(filters),
      this.repo.countComplaintsByCategory(filters),
      this.repo.countOpenAmlAlertsByPatternType(filters),
      this.auditTrail.findAuditLog(
        { entityType: 'InternalControlsAuditReport' },
        1,
      ),
      this.repo.findComplianceCalendarItems(),
      this.repo.countDsrByStatus(filters),
      this.repo.countIncidentsByStatus(),
      this.repo.countDpiaByOutcome(),
      this.repo.countDpiaPendingReview(),
    ]);

    const summary = buildComplianceDashboardSummary({
      now,
      kycByStatus,
      complaintsByStatus,
      complaintsByCategory,
      amlOpenByPatternType,
      lastSelfApprovalScan: parseLastSelfApprovalScan(
        lastScanRows[0]?.afterValue ?? null,
        lastScanRows[0]?.occurredAt,
      ),
      regulatoryFilingRows,
      dsrByStatus,
      incidentByStatus,
      dpiaByOutcome,
      dpiaPendingReviewCount,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'ComplianceDashboard',
      entityId: summary.generatedAt,
      // Unconditional, not data-presence-gated (contrast Financial/Profitability's
      // `claimCount > 0` conditional): every call aggregates KYCRecord, Complaint,
      // DataSubjectRequest, and TransactionMonitoringAlert (AML) counts — all four
      // named explicitly in sensitive-data-handling.md's trigger list — so there is
      // no code path through this method that doesn't touch personal-data-bearing
      // records, unlike a dashboard where the sensitive slice is optional.
      isSensitiveDataAccess: true,
      afterValue: complianceDashboardAuditSnapshot(summary),
    });

    return summary;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Compliance dashboard audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

/** `afterValue` is the loose `Prisma.JsonValue` the audit trail returns —
 * narrowed here rather than trusting its shape. Falls back to the audit
 * row's own `occurredAt` for `asOf` if `afterValue.generatedAt` is somehow
 * missing, and returns `null` entirely if no scan has ever run. */
function parseLastSelfApprovalScan(
  afterValue: Prisma.JsonValue | null,
  occurredAt: Date | undefined,
): { asOf: Date; violationCount: number } | null {
  if (
    !afterValue ||
    typeof afterValue !== 'object' ||
    Array.isArray(afterValue)
  )
    return null;
  const violationCount = afterValue.violationCount;
  if (typeof violationCount !== 'number') return null;
  const generatedAt =
    typeof afterValue.generatedAt === 'string'
      ? new Date(afterValue.generatedAt)
      : occurredAt;
  if (!generatedAt) return null;
  return { asOf: generatedAt, violationCount };
}

function complianceDashboardAuditSnapshot(
  summary: ComplianceDashboardSummary,
): Prisma.InputJsonObject {
  return {
    dsrOpenCount: summary.dsr.openCount,
    breachRegisterOpenCount: summary.breachRegister.openCount,
    dpiaPendingReviewCount: summary.dpiaBacklog.pendingReviewCount,
    openAmlAlertsCount: summary.complianceExceptions.openAmlAlertsCount,
    regulatoryFilingOverdueCount: summary.regulatoryFilings.overdueCount,
  };
}
