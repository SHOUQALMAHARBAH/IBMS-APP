import { describe, expect, it } from 'vitest';
import {
  deriveIncidentReportView,
  incidentReportAuditSnapshot,
  isContainmentOverdue,
  requiresContainmentSla,
  INCIDENT_SEVERITIES,
  INCIDENT_REGULATORS,
  type IncidentReportRow,
} from './incident.config';

const NOW = new Date('2026-09-06T12:00:00.000Z');

function row(overrides: Partial<IncidentReportRow> = {}): IncidentReportRow {
  return {
    id: 'incident-1',
    title: 'Phishing email reached staff mailboxes',
    description: 'Three staff clicked a malicious link.',
    severity: 'critical',
    status: 'REPORTED',
    reportedAt: new Date('2026-09-06T09:00:00.000Z'),
    containedAt: null,
    impactAssessedAt: null,
    classification: 'NOT_YET_CLASSIFIED',
    classifiedByDpoUserId: null,
    seniorManagementCoSignUserId: null,
    seniorManagementNotifiedAt: null,
    notifiedRegulators: [],
    notifiedAt: null,
    affectedDataSubjectsNotifiedAt: null,
    rootCauseAnalysis: null,
    recoveredAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('INCIDENT_SEVERITIES / INCIDENT_REGULATORS (Process 55)', () => {
  it('has exactly the four severities', () => {
    expect([...INCIDENT_SEVERITIES]).toEqual([
      'low',
      'medium',
      'high',
      'critical',
    ]);
  });
  it('has exactly the three named regulators', () => {
    expect([...INCIDENT_REGULATORS]).toEqual([
      'CBJ',
      'NCSC',
      'Personal_Data_Protection_Council',
    ]);
  });
});

describe('requiresContainmentSla (Process 55)', () => {
  it('is true only for critical severity', () => {
    expect(requiresContainmentSla('critical')).toBe(true);
    expect(requiresContainmentSla('high')).toBe(false);
    expect(requiresContainmentSla('medium')).toBe(false);
    expect(requiresContainmentSla('low')).toBe(false);
  });
});

describe('isContainmentOverdue (Process 55)', () => {
  it('is false for a non-critical severity regardless of elapsed time', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'high',
          reportedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is false once containedAt is set, even for critical severity past 4h', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'critical',
          reportedAt: new Date('2026-09-01T00:00:00.000Z'),
          containedAt: new Date('2026-09-01T10:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is false for a critical incident still within the 4-hour window', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'critical',
          reportedAt: new Date('2026-09-06T09:00:00.000Z'),
        }),
        new Date('2026-09-06T10:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('is true for a critical, uncontained incident past 4 hours', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'critical',
          reportedAt: new Date('2026-09-06T09:00:00.000Z'),
        }),
        new Date('2026-09-06T13:30:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('deriveIncidentReportView (Process 55)', () => {
  it('serializes null timestamps as null, not undefined', () => {
    const view = deriveIncidentReportView(row(), NOW);
    expect(view.containedAt).toBeNull();
    expect(view.classifiedByDpoUserId).toBeNull();
    expect(view.rootCauseAnalysis).toBeNull();
  });

  it('carries notifiedRegulators through as an array', () => {
    const view = deriveIncidentReportView(
      row({ notifiedRegulators: ['CBJ', 'NCSC'] }),
      NOW,
    );
    expect(view.notifiedRegulators).toEqual(['CBJ', 'NCSC']);
  });
});

describe('incidentReportAuditSnapshot (Process 55)', () => {
  it('carries ids/status/classification verbatim', () => {
    const snapshot = incidentReportAuditSnapshot(
      row({ status: 'CLASSIFIED', classification: 'MATERIAL' }),
    );
    expect(snapshot.incidentReportId).toBe('incident-1');
    expect(snapshot.status).toBe('CLASSIFIED');
    expect(snapshot.classification).toBe('MATERIAL');
  });
});
