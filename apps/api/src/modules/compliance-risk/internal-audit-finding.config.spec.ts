import { describe, expect, it } from 'vitest';
import {
  deriveInternalAuditFindingView,
  internalAuditFindingAuditSnapshot,
  INTERNAL_AUDIT_FINDING_STATUSES,
  type InternalAuditFindingRow,
} from './internal-audit-finding.config';

const row: InternalAuditFindingRow = {
  id: 'finding-1',
  auditPeriodLabel: 'Q3 2026 Internal Audit',
  finding: 'Two officers shared a login during a system outage.',
  remediationAction: 'Rotated the shared credential and retrained staff.',
  status: 'open',
  loggedAt: new Date('2026-09-01T09:00:00.000Z'),
  closedAt: null,
};

describe('INTERNAL_AUDIT_FINDING_STATUSES', () => {
  it('is exactly open/closed — the RiskRegisterItem shape', () => {
    expect(INTERNAL_AUDIT_FINDING_STATUSES).toEqual(['open', 'closed']);
  });
});

describe('deriveInternalAuditFindingView', () => {
  it('maps every field and ISO-stamps the dates', () => {
    expect(deriveInternalAuditFindingView(row)).toEqual({
      id: 'finding-1',
      auditPeriodLabel: 'Q3 2026 Internal Audit',
      finding: 'Two officers shared a login during a system outage.',
      remediationAction: 'Rotated the shared credential and retrained staff.',
      status: 'open',
      loggedAt: '2026-09-01T09:00:00.000Z',
      closedAt: null,
    });
  });

  it('renders a null closedAt as null, not a crash', () => {
    const closed = {
      ...row,
      status: 'closed',
      closedAt: new Date('2026-09-05T10:00:00.000Z'),
    };
    expect(deriveInternalAuditFindingView(closed).closedAt).toBe(
      '2026-09-05T10:00:00.000Z',
    );
  });
});

describe('internalAuditFindingAuditSnapshot', () => {
  it('carries the finding/remediation narrative verbatim into the audit row', () => {
    expect(internalAuditFindingAuditSnapshot(row)).toEqual({
      internalAuditFindingId: 'finding-1',
      auditPeriodLabel: 'Q3 2026 Internal Audit',
      finding: 'Two officers shared a login during a system outage.',
      remediationAction: 'Rotated the shared credential and retrained staff.',
      status: 'open',
      loggedAt: '2026-09-01T09:00:00.000Z',
      closedAt: null,
    });
  });
});
