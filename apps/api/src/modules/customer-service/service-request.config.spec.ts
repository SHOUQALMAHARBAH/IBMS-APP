import { describe, expect, it } from 'vitest';
import {
  deriveServiceRequestView,
  isServiceRequestTransition,
  isTerminalServiceRequestStatus,
  serviceRequestAuditSnapshot,
  serviceRequestUpdateAuditSnapshot,
  type ServiceRequestRow,
} from './service-request.config';

describe('isServiceRequestTransition (Process 41)', () => {
  it('allows open -> in_progress | fulfilled | cancelled and in_progress -> {fulfilled|cancelled}', () => {
    expect(isServiceRequestTransition('open', 'in_progress')).toBe(true);
    expect(isServiceRequestTransition('open', 'fulfilled')).toBe(true);
    expect(isServiceRequestTransition('open', 'cancelled')).toBe(true);
    expect(isServiceRequestTransition('in_progress', 'fulfilled')).toBe(true);
    expect(isServiceRequestTransition('in_progress', 'cancelled')).toBe(true);
  });

  it('rejects moves out of a terminal state, in_progress -> open, and an unknown from', () => {
    expect(isServiceRequestTransition('fulfilled', 'cancelled')).toBe(false);
    expect(isServiceRequestTransition('cancelled', 'fulfilled')).toBe(false);
    expect(isServiceRequestTransition('in_progress', 'open')).toBe(false);
    expect(isServiceRequestTransition('nonsense', 'fulfilled')).toBe(false);
  });

  it('isTerminalServiceRequestStatus is true only for fulfilled / cancelled', () => {
    expect(isTerminalServiceRequestStatus('fulfilled')).toBe(true);
    expect(isTerminalServiceRequestStatus('cancelled')).toBe(true);
    expect(isTerminalServiceRequestStatus('open')).toBe(false);
    expect(isTerminalServiceRequestStatus('in_progress')).toBe(false);
  });
});

describe('deriveServiceRequestView (Process 41)', () => {
  const base: ServiceRequestRow = {
    id: 'sr-1',
    customerId: 'cust-1',
    policyId: 'pol-1',
    requestType: 'certificate',
    detail: 'Certificate of insurance for the landlord',
    status: 'open',
    slaTimerId: 'sla-1',
    slaTimer: {
      id: 'sla-1',
      dueAt: new Date('2026-09-10T00:00:00.000Z'),
      escalatedAt: null,
      escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
      resolvedAt: null,
    },
    raisedByUserId: 'u-sales',
    assignedToUserId: null,
    fulfilledByUserId: null,
    outcomeNote: null,
    createdAt: new Date('2026-09-03T09:00:00.000Z'),
    closedAt: null,
  };

  it('renders the request + an unbreached, unresolved SLA (now before dueAt)', () => {
    const v = deriveServiceRequestView(
      base,
      new Date('2026-09-05T00:00:00.000Z'),
    );
    expect(v).toMatchObject({
      id: 'sr-1',
      status: 'open',
      isClosed: false,
      detail: 'Certificate of insurance for the landlord',
    });
    expect(v.sla).toEqual({
      timerId: 'sla-1',
      dueAt: '2026-09-10T00:00:00.000Z',
      escalatedAt: null,
      escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
      resolvedAt: null,
      breached: false,
    });
  });

  it('flags breached when now is past dueAt and the timer is not resolved', () => {
    const v = deriveServiceRequestView(
      base,
      new Date('2026-09-11T00:00:00.000Z'),
    );
    expect(v.sla?.breached).toBe(true);
  });

  it('is NOT breached once the timer is resolved, even after dueAt', () => {
    const v = deriveServiceRequestView(
      {
        ...base,
        slaTimer: {
          ...base.slaTimer!,
          resolvedAt: new Date('2026-09-08T00:00:00.000Z'),
        },
      },
      new Date('2026-09-11T00:00:00.000Z'),
    );
    expect(v.sla?.breached).toBe(false);
  });

  it('surfaces a closed request (fulfilled) with its outcome + no SLA row', () => {
    const v = deriveServiceRequestView({
      ...base,
      status: 'fulfilled',
      fulfilledByUserId: 'u-sales',
      outcomeNote: 'Certificate issued and emailed.',
      slaTimer: null,
      closedAt: new Date('2026-09-06T12:00:00.000Z'),
    });
    expect(v.isClosed).toBe(true);
    expect(v.outcomeNote).toBe('Certificate issued and emailed.');
    expect(v.sla).toBeNull();
    expect(v.closedAt).toBe('2026-09-06T12:00:00.000Z');
  });
});

describe('service-request audit snapshots (Process 41)', () => {
  it('CREATE snapshot carries ids + type + detail + status, nothing else', () => {
    const snap = serviceRequestAuditSnapshot({
      serviceRequestId: 'sr-1',
      customerId: 'cust-1',
      policyId: 'pol-1',
      requestType: 'change',
      detail: 'Update the correspondence address.',
      status: 'open',
      assignedToUserId: 'u-2',
    });
    expect(snap).toEqual({
      serviceRequestId: 'sr-1',
      customerId: 'cust-1',
      policyId: 'pol-1',
      requestType: 'change',
      detail: 'Update the correspondence address.',
      status: 'open',
      assignedToUserId: 'u-2',
    });
  });

  it('UPDATE snapshot carries the new status + who + the verbatim outcome note', () => {
    const snap = serviceRequestUpdateAuditSnapshot({
      serviceRequestId: 'sr-1',
      customerId: 'cust-1',
      status: 'cancelled',
      assignedToUserId: 'u-2',
      fulfilledByUserId: null,
      outcomeNote: 'Duplicate of SR-9; cancelled at the customer’s request.',
      closedAt: new Date('2026-09-06T12:00:00.000Z'),
    });
    expect(snap).toMatchObject({
      status: 'cancelled',
      outcomeNote: 'Duplicate of SR-9; cancelled at the customer’s request.',
      closedAt: '2026-09-06T12:00:00.000Z',
    });
  });
});
