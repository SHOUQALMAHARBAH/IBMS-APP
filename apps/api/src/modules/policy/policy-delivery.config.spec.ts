import { describe, expect, it } from 'vitest';
import {
  DELIVERY_METHODS,
  deliveryAuditSnapshot,
  receiptAckAuditSnapshot,
} from './policy-delivery.config';

describe('policy-delivery.config', () => {
  it('enumerates exactly the four delivery methods', () => {
    expect([...DELIVERY_METHODS]).toEqual([
      'email',
      'portal',
      'courier',
      'in_person',
    ]);
  });

  it('deliveryAuditSnapshot carries method / recipient / deliveredAt as an ISO string', () => {
    const snap = deliveryAuditSnapshot({
      policyId: 'pol-1',
      method: 'email',
      recipient: 'ops@acme.test',
      deliveredAt: new Date('2026-10-06T09:00:00Z'),
    });
    expect(snap).toEqual({
      policyId: 'pol-1',
      method: 'email',
      recipient: 'ops@acme.test',
      deliveredAt: '2026-10-06T09:00:00.000Z',
    });
  });

  it('receiptAckAuditSnapshot carries the ack timestamp', () => {
    const snap = receiptAckAuditSnapshot({
      policyId: 'pol-1',
      deliveryRecordId: 'del-1',
      receiptAcknowledgedAt: new Date('2026-10-08T12:00:00Z'),
    });
    expect(snap).toEqual({
      policyId: 'pol-1',
      deliveryRecordId: 'del-1',
      receiptAcknowledgedAt: '2026-10-08T12:00:00.000Z',
    });
  });
});
