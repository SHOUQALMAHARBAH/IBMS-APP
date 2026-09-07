import { describe, expect, it, vi } from 'vitest';
import { DpoWorkspaceService } from './dpo-workspace.service';
import type { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import type { DsrRepository } from '../../repositories/dsr.repository';
import type { IncidentRepository } from '../../repositories/incident.repository';
import type { DpiaScreeningRepository } from '../../repositories/dpia-screening.repository';
import type { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import type { CrossBorderTransferRepository } from '../../repositories/cross-border-transfer.repository';
import type { AuditService } from '../audit/audit.service';

const consentRow = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  leadId: null,
  purpose: 'MARKETING',
  isMarketing: true,
  granted: true,
  consentTextVersion: 'v1',
  grantedAt: new Date('2026-09-01T00:00:00.000Z'),
  withdrawnAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

const dsrRow = (over: Record<string, unknown> = {}) => ({
  id: 'dsr-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  type: 'ACCESS',
  status: 'IN_PROGRESS',
  receivedAt: new Date('2026-09-01T00:00:00.000Z'),
  identityVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),
  slaDueAt: new Date('2026-09-25T00:00:00.000Z'),
  accessExtensionAppliedAt: null,
  extensionReason: null,
  retentionScheduleReference: null,
  partialFulfilmentJustification: null,
  closedAt: null,
  dpoHandlerUserId: 'u-dpo',
  processedByUserId: null,
  closedByUserId: null,
  rejectionReason: null,
  noOpenRetentionHoldConfirmedAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

const incidentRow = (over: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  title: 'Phishing attempt',
  description: 'A phishing email targeted staff.',
  severity: 'HIGH',
  status: 'CONTAINED',
  reportedAt: new Date('2026-09-01T00:00:00.000Z'),
  containedAt: new Date('2026-09-01T00:00:00.000Z'),
  impactAssessedAt: null,
  classification: 'NON_MATERIAL',
  classifiedByDpoUserId: null,
  seniorManagementCoSignUserId: null,
  seniorManagementNotifiedAt: null,
  notifiedRegulators: [],
  notifiedAt: null,
  affectedDataSubjectsNotifiedAt: null,
  rootCauseAnalysis: null,
  recoveredAt: null,
  closedAt: null,
  ...over,
});

const legalHoldRow = (over: Record<string, unknown> = {}) => ({
  id: 'lh-1',
  scope: 'Customer XYZ file',
  reason: 'Litigation pending.',
  placedAt: new Date('2026-09-01T00:00:00.000Z'),
  nextReviewDueAt: new Date('2027-03-01T00:00:00.000Z'),
  releasedAt: null,
  retentionScheduleItemId: null,
  ...over,
});

const cbtRow = (over: Record<string, unknown> = {}) => ({
  id: 'cbt-1',
  description: 'x',
  destinationCountry: 'UK',
  legalBasis: 'standard_contractual_clauses',
  legalBasisEvidenceRef: null,
  approvedByUserId: 'u-dpo',
  transferredAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

const dpiaRow = (over: Record<string, unknown> = {}) => ({
  id: 'dpia-1',
  subjectDescription: 'x',
  qSensitiveData: true,
  qLargeScaleProcessing: false,
  qCrossBorderTransfer: false,
  qNewTechnologyMonitoring: false,
  qNewDigitalChannel: false,
  outcome: 'DPO_REVIEW_REQUIRED',
  dpoReviewDueAt: new Date('2026-09-14T00:00:00.000Z'),
  dpoReviewedAt: null,
  dpoSpotCheckedAt: null,
  escalatedToFullDpiaAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

function makeService() {
  const consentRecords = {
    findMany: vi.fn().mockResolvedValue([consentRow()]),
  };
  const dsr = {
    findMany: vi
      .fn()
      .mockResolvedValue([
        dsrRow(),
        dsrRow({ id: 'dsr-closed', status: 'CLOSED' }),
      ]),
  };
  const incidents = {
    findMany: vi
      .fn()
      .mockResolvedValue([
        incidentRow(),
        incidentRow({ id: 'inc-closed', status: 'CLOSED' }),
      ]),
  };
  const dpia = { findMany: vi.fn().mockResolvedValue([dpiaRow()]) };
  const legalHolds = { findMany: vi.fn().mockResolvedValue([legalHoldRow()]) };
  const crossBorderTransfers = {
    findMany: vi.fn().mockResolvedValue([cbtRow()]),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const service = new DpoWorkspaceService(
    consentRecords as unknown as ConsentRecordRepository,
    dsr as unknown as DsrRepository,
    incidents as unknown as IncidentRepository,
    dpia as unknown as DpiaScreeningRepository,
    legalHolds as unknown as LegalHoldRepository,
    crossBorderTransfers as unknown as CrossBorderTransferRepository,
    audit as unknown as AuditService,
  );
  return {
    service,
    consentRecords,
    dsr,
    incidents,
    dpia,
    legalHolds,
    crossBorderTransfers,
    audit,
  };
}

describe('DpoWorkspaceService.getSummary', () => {
  it('aggregates all six registers and excludes closed DSRs/incidents', async () => {
    const { service } = makeService();
    const summary = await service.getSummary('u-dpo');

    expect(summary.dsrQueue).toHaveLength(1);
    expect(summary.dsrQueue[0].id).toBe('dsr-1');
    expect(typeof summary.dsrQueue[0].daysUntilDue).toBe('number');

    expect(summary.incidentRegister).toHaveLength(1);
    expect(summary.incidentRegister[0].id).toBe('inc-1');

    expect(summary.consentStatus).toEqual({
      activeCount: 1,
      withdrawnCount: 0,
      declinedCount: 0,
    });
    expect(summary.dpiaRegister).toHaveLength(1);
    expect(summary.legalHoldRegister).toHaveLength(1);
    expect(summary.crossBorderTransferRegister).toHaveLength(1);
  });

  it('requests only DPO_REVIEW_REQUIRED DPIA screenings and only active Legal Holds', async () => {
    const { service, dpia, legalHolds } = makeService();
    await service.getSummary('u-dpo');
    expect(dpia.findMany).toHaveBeenCalledWith(
      { outcome: 'DPO_REVIEW_REQUIRED' },
      expect.any(Number),
    );
    expect(legalHolds.findMany).toHaveBeenCalledWith({ active: true });
  });

  it('records a sensitive READ audit row with per-register counts, not the underlying data', async () => {
    const { service, audit } = makeService();
    await service.getSummary('u-dpo');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-dpo',
        action: 'READ',
        entityType: 'DpoWorkspace',
        isSensitiveDataAccess: true,
      }),
    );
  });
});
