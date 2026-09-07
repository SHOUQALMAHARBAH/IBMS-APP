import { describe, expect, it } from 'vitest';
import {
  dataSharingApprovalAuditSnapshot,
  deriveDataSharingApprovalView,
  type DataSharingApprovalRow,
} from './data-sharing-approval.config';

const row = (
  over: Partial<DataSharingApprovalRow> = {},
): DataSharingApprovalRow => ({
  id: 'dsa-1',
  vendorId: 'vendor-1',
  description:
    'Claims documents shared with a loss adjuster for a large fire claim.',
  classification: 'CONFIDENTIAL',
  channel: 'ENCRYPTED_EMAIL',
  isRegulatoryChannel: false,
  requestedByUserId: 'u-req',
  approvedByUserId: null,
  slaDueAt: new Date('2026-09-10T00:00:00.000Z'),
  decidedAt: null,
  createdAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

describe('deriveDataSharingApprovalView', () => {
  it('is pending when decidedAt is null', () => {
    const v = deriveDataSharingApprovalView(row());
    expect(v.isPending).toBe(true);
    expect(v.isApproved).toBe(false);
    expect(v.isDeclined).toBe(false);
  });

  it('is approved when decidedAt and approvedByUserId are both set', () => {
    const v = deriveDataSharingApprovalView(
      row({
        decidedAt: new Date('2026-09-08T00:00:00.000Z'),
        approvedByUserId: 'u-dpo',
      }),
    );
    expect(v.isApproved).toBe(true);
    expect(v.isDeclined).toBe(false);
    expect(v.isPending).toBe(false);
  });

  it('is declined when decidedAt is set but approvedByUserId stays null', () => {
    const v = deriveDataSharingApprovalView(
      row({
        decidedAt: new Date('2026-09-08T00:00:00.000Z'),
        approvedByUserId: null,
      }),
    );
    expect(v.isDeclined).toBe(true);
    expect(v.isApproved).toBe(false);
    expect(v.isPending).toBe(false);
  });
});

describe('dataSharingApprovalAuditSnapshot', () => {
  it('includes the operational description and channel/classification', () => {
    const snap = dataSharingApprovalAuditSnapshot(row());
    expect(snap).toMatchObject({
      dataSharingApprovalId: 'dsa-1',
      vendorId: 'vendor-1',
      classification: 'CONFIDENTIAL',
      channel: 'ENCRYPTED_EMAIL',
      isRegulatoryChannel: false,
    });
  });
});
