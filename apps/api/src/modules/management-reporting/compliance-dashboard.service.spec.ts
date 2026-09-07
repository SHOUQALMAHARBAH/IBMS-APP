import { describe, expect, it, vi } from 'vitest';
import { ComplianceDashboardService } from './compliance-dashboard.service';
import type { ComplianceDashboardRepository } from '../../repositories/compliance-dashboard.repository';
import type { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import type { AuditService } from '../audit/audit.service';

function makeService(
  over: {
    repo?: Record<string, unknown>;
    auditTrail?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    findUserIdsInBranch: vi
      .fn()
      .mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]),
    countKycByStatus: vi.fn().mockResolvedValue([]),
    countComplaintsByStatus: vi.fn().mockResolvedValue([]),
    countComplaintsByCategory: vi.fn().mockResolvedValue([]),
    countOpenAmlAlertsByPatternType: vi.fn().mockResolvedValue([]),
    findComplianceCalendarItems: vi.fn().mockResolvedValue([]),
    countDsrByStatus: vi.fn().mockResolvedValue([]),
    countIncidentsByStatus: vi.fn().mockResolvedValue([]),
    countDpiaByOutcome: vi.fn().mockResolvedValue([]),
    countDpiaPendingReview: vi.fn().mockResolvedValue(0),
    ...over.repo,
  };
  const auditTrail = {
    findAuditLog: vi.fn().mockResolvedValue([]),
    ...over.auditTrail,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ComplianceDashboardService(
    repo as unknown as ComplianceDashboardRepository,
    auditTrail as unknown as AuditTrailRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, auditTrail, audit };
}

describe('ComplianceDashboardService.summary', () => {
  it('resolves branchId to concrete user ids and forwards them to every owner-scoped query', async () => {
    const { service, repo } = makeService();
    await service.summary({ branchId: 'branch-1' }, 'u-actor');
    expect(repo.findUserIdsInBranch).toHaveBeenCalledWith('branch-1');
    expect(repo.countKycByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
    expect(repo.countComplaintsByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
    expect(repo.countDsrByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
    expect(repo.countOpenAmlAlertsByPatternType).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: ['u-1', 'u-2'] }),
    );
  });

  it('does not resolve a branch when none is given', async () => {
    const { service, repo } = makeService();
    await service.summary({}, 'u-actor');
    expect(repo.findUserIdsInBranch).not.toHaveBeenCalled();
    expect(repo.countKycByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserIds: undefined }),
    );
  });

  it('never scopes incident/DPIA reads by branch — neither model has an owner relation', async () => {
    const { service, repo } = makeService();
    await service.summary({ branchId: 'branch-1' }, 'u-actor');
    expect(repo.countIncidentsByStatus).toHaveBeenCalledWith();
    expect(repo.countDpiaByOutcome).toHaveBeenCalledWith();
  });

  it('reads the most recent InternalControlsAuditReport audit row, not a live re-scan', async () => {
    const { service, auditTrail } = makeService({
      auditTrail: {
        findAuditLog: vi.fn().mockResolvedValue([
          {
            id: 'log-1',
            userId: 'u-x',
            action: 'READ',
            entityType: 'InternalControlsAuditReport',
            entityId: 'self-approval-audit',
            beforeValue: null,
            afterValue: {
              generatedAt: '2026-09-01T00:00:00.000Z',
              pairsScanned: 16,
              totalRowsChecked: 500,
              violationCount: 2,
            },
            isSensitiveDataAccess: false,
            occurredAt: new Date('2026-09-01T00:05:00.000Z'),
          },
        ]),
      },
    });
    const summary = await service.summary({}, 'u-actor');
    expect(auditTrail.findAuditLog).toHaveBeenCalledWith(
      { entityType: 'InternalControlsAuditReport' },
      1,
    );
    expect(summary.complianceExceptions.lastSelfApprovalScan).toEqual({
      asOf: '2026-09-01T00:00:00.000Z',
      violationCount: 2,
    });
  });

  it('reports a null last-scan when the audit has never run', async () => {
    const { service } = makeService();
    const summary = await service.summary({}, 'u-actor');
    expect(summary.complianceExceptions.lastSelfApprovalScan).toBeNull();
  });

  it('records a READ audit row as sensitive data access, with counts only', async () => {
    const { service, audit } = makeService();
    await service.summary({}, 'u-actor');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-actor',
        action: 'READ',
        entityType: 'ComplianceDashboard',
        isSensitiveDataAccess: true,
      }),
    );
  });
});
