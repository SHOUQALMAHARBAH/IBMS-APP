import { describe, expect, it } from 'vitest';
import {
  complaintActionAuditSnapshot,
  complaintAuditSnapshot,
  complaintUpdateAuditSnapshot,
  COMPLAINT_SLA_WORKFLOW,
  DEFAULT_ESCALATION_TARGET,
  deriveComplaintView,
  escalationAuditSnapshot,
  isTerminalComplaintStatus,
  type ComplaintRow,
} from './complaint.config';

const baseRow = (over: Partial<ComplaintRow> = {}): ComplaintRow => ({
  id: 'c-1',
  customerId: 'cust-1',
  claimId: null,
  policyId: null,
  issue: 'Claim payment was 200 JOD short of the assessed amount',
  category: 'denied_claim',
  status: 'IN_PROGRESS',
  slaTimerId: 'sla-1',
  slaTimer: {
    id: 'sla-1',
    dueAt: new Date('2026-09-17T00:00:00.000Z'),
    escalatedAt: null,
    escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
    resolvedAt: null,
  },
  responsibleEmployeeUserId: 'u-claims',
  resolution: null,
  resolvedByUserId: null,
  resolvedAt: null,
  closureApprovedByUserId: null,
  closedAt: null,
  createdAt: new Date('2026-09-03T09:00:00.000Z'),
  actions: [],
  escalations: [],
  ...over,
});

describe('complaint.config', () => {
  it('only CLOSED is terminal', () => {
    expect(isTerminalComplaintStatus('CLOSED')).toBe(true);
    for (const s of [
      'LOGGED',
      'ASSIGNED',
      'IN_PROGRESS',
      'RESOLVED',
      'ESCALATED',
    ]) {
      expect(isTerminalComplaintStatus(s)).toBe(false);
    }
  });

  it('the SLA workflow name + default escalation target are the documented values', () => {
    expect(COMPLAINT_SLA_WORKFLOW).toBe('complaint_resolution');
    expect(DEFAULT_ESCALATION_TARGET).toBe('dispute_resolution_committee');
  });

  describe('deriveComplaintView', () => {
    it('maps the row, flags breach only when overdue AND unresolved', () => {
      const now = new Date('2026-09-20T00:00:00.000Z'); // past dueAt
      const v = deriveComplaintView(baseRow(), now);
      expect(v.status).toBe('IN_PROGRESS');
      expect(v.isClosed).toBe(false);
      expect(v.sla?.breached).toBe(true);
    });

    it('a resolved SLA timer is never breached', () => {
      const now = new Date('2026-09-20T00:00:00.000Z');
      const v = deriveComplaintView(
        baseRow({
          slaTimer: {
            id: 'sla-1',
            dueAt: new Date('2026-09-17T00:00:00.000Z'),
            escalatedAt: null,
            escalatedTo: null,
            resolvedAt: new Date('2026-09-16T00:00:00.000Z'),
          },
        }),
        now,
      );
      expect(v.sla?.breached).toBe(false);
    });

    it('sorts actions and escalations chronologically and passes text through', () => {
      const v = deriveComplaintView(
        baseRow({
          actions: [
            {
              id: 'a-2',
              actionText: 'Called the insurer',
              takenByUserId: 'u-claims',
              takenAt: new Date('2026-09-05T00:00:00.000Z'),
            },
            {
              id: 'a-1',
              actionText: 'Logged and acknowledged',
              takenByUserId: 'u-sales',
              takenAt: new Date('2026-09-03T10:00:00.000Z'),
            },
          ],
          escalations: [
            {
              id: 'e-1',
              escalatedTo: 'dispute_resolution_committee',
              escalatedByUserId: 'u-mgr',
              reason: 'insurer non-response 20 days',
              escalatedAt: new Date('2026-09-19T00:00:00.000Z'),
            },
          ],
        }),
      );
      expect(v.actions.map((a) => a.id)).toEqual(['a-1', 'a-2']);
      expect(v.escalations[0]?.escalatedTo).toBe(
        'dispute_resolution_committee',
      );
      expect(v.escalations[0]?.reason).toBe('insurer non-response 20 days');
    });

    it('null SLA timer -> sla is null', () => {
      const v = deriveComplaintView(baseRow({ slaTimer: null }));
      expect(v.sla).toBeNull();
    });
  });

  describe('audit snapshots', () => {
    it('CREATE carries the issue verbatim + ids, no derived fields', () => {
      const snap = complaintAuditSnapshot({
        complaintId: 'c-1',
        customerId: 'cust-1',
        claimId: 'claim-1',
        policyId: null,
        issue: 'verbatim issue text',
        category: 'premium_dispute',
        status: 'LOGGED',
        responsibleEmployeeUserId: null,
      });
      expect(snap).toMatchObject({
        complaintId: 'c-1',
        claimId: 'claim-1',
        issue: 'verbatim issue text',
        status: 'LOGGED',
      });
    });

    it('UPDATE carries the resolution + maker/checker trail', () => {
      const snap = complaintUpdateAuditSnapshot({
        complaintId: 'c-1',
        customerId: 'cust-1',
        status: 'CLOSED',
        responsibleEmployeeUserId: 'u-claims',
        resolution: 'Insurer paid the 200 JOD difference; customer satisfied.',
        resolvedByUserId: 'u-claims',
        closureApprovedByUserId: 'u-mgr',
        closedAt: new Date('2026-09-10T00:00:00.000Z'),
      });
      expect(snap).toMatchObject({
        status: 'CLOSED',
        resolution: 'Insurer paid the 200 JOD difference; customer satisfied.',
        resolvedByUserId: 'u-claims',
        closureApprovedByUserId: 'u-mgr',
        closedAt: '2026-09-10T00:00:00.000Z',
      });
    });

    it('ComplaintAction + EscalationRecord snapshots carry text verbatim', () => {
      expect(
        complaintActionAuditSnapshot({
          complaintActionId: 'a-1',
          complaintId: 'c-1',
          actionText: 'Chased the insurer a second time',
          takenByUserId: 'u-claims',
        }),
      ).toMatchObject({ actionText: 'Chased the insurer a second time' });
      expect(
        escalationAuditSnapshot({
          escalationRecordId: 'e-1',
          complaintId: 'c-1',
          escalatedTo: 'dispute_resolution_committee',
          escalatedByUserId: 'u-mgr',
          reason: 'unresolved after 25 days',
        }),
      ).toMatchObject({
        escalatedTo: 'dispute_resolution_committee',
        reason: 'unresolved after 25 days',
      });
    });
  });
});
