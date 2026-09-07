import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { StatusCountRow } from '../modules/management-reporting/compliance-dashboard.config';
import type { ComplianceCalendarItemRow } from '../modules/compliance-risk/compliance-calendar.config';

export interface ComplianceDashboardFilters {
  ownerUserIds?: string[];
}

export const COMPLIANCE_CALENDAR_SCAN_LIMIT = 5000;

@Injectable()
export class ComplianceDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserIdsInBranch(branchId: string): Promise<{ id: string }[]> {
    return this.prisma.client.user.findMany({
      where: { branchId },
      select: { id: true },
    });
  }

  async countKycByStatus(
    filters: ComplianceDashboardFilters,
  ): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.kYCRecord.groupBy({
      by: ['status'],
      where: filters.ownerUserIds
        ? { customer: { ownerUserId: { in: filters.ownerUserIds } } }
        : {},
      _count: { _all: true },
    });
    return rows.map((r) => ({ key: r.status, count: r._count._all }));
  }

  async countComplaintsByStatus(
    filters: ComplianceDashboardFilters,
  ): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.complaint.groupBy({
      by: ['status'],
      where: filters.ownerUserIds
        ? { customer: { ownerUserId: { in: filters.ownerUserIds } } }
        : {},
      _count: { _all: true },
    });
    return rows.map((r) => ({ key: r.status, count: r._count._all }));
  }

  async countComplaintsByCategory(
    filters: ComplianceDashboardFilters,
  ): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.complaint.groupBy({
      by: ['category'],
      where: filters.ownerUserIds
        ? { customer: { ownerUserId: { in: filters.ownerUserIds } } }
        : {},
      _count: { _all: true },
    });
    return rows.map((r) => ({
      key: r.category ?? 'uncategorized',
      count: r._count._all,
    }));
  }

  async countOpenAmlAlertsByPatternType(
    filters: ComplianceDashboardFilters,
  ): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.transactionMonitoringAlert.groupBy({
      by: ['patternType'],
      where: {
        status: 'open',
        ...(filters.ownerUserIds
          ? { customer: { is: { ownerUserId: { in: filters.ownerUserIds } } } }
          : {}),
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({ key: r.patternType, count: r._count._all }));
  }

  /** No branch scoping — `ownerUserId` here names the COMPLIANCE STAFF
   * member tracking the obligation, not a Sales Officer/branch concept. */
  findComplianceCalendarItems(): Promise<ComplianceCalendarItemRow[]> {
    return this.prisma.client.complianceCalendarItem.findMany({
      select: {
        id: true,
        obligationName: true,
        ownerUserId: true,
        dueDate: true,
        evidenceOfSubmissionRef: true,
        submittedAt: true,
      },
      take: COMPLIANCE_CALENDAR_SCAN_LIMIT,
    });
  }

  async countDsrByStatus(
    filters: ComplianceDashboardFilters,
  ): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.dataSubjectRequest.groupBy({
      by: ['status'],
      where: filters.ownerUserIds
        ? { customer: { is: { ownerUserId: { in: filters.ownerUserIds } } } }
        : {},
      _count: { _all: true },
    });
    return rows.map((r) => ({ key: r.status, count: r._count._all }));
  }

  /** No branch scoping — `IncidentReport` carries no `Customer`/owner
   * relation at all (a company-wide operational incident). */
  async countIncidentsByStatus(): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.incidentReport.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return rows.map((r) => ({ key: r.status, count: r._count._all }));
  }

  /** No branch scoping — `DpiaScreening` carries no `Customer`/owner
   * relation at all (a screening of a product/system/vendor, not a client). */
  async countDpiaByOutcome(): Promise<StatusCountRow[]> {
    const rows = await this.prisma.client.dpiaScreening.groupBy({
      by: ['outcome'],
      _count: { _all: true },
    });
    return rows.map((r) => ({ key: r.outcome, count: r._count._all }));
  }

  countDpiaPendingReview(): Promise<number> {
    return this.prisma.client.dpiaScreening.count({
      where: {
        outcome: { in: ['DPO_REVIEW_REQUIRED', 'ESCALATED_FULL_DPIA'] },
        dpoReviewedAt: null,
      },
    });
  }
}
