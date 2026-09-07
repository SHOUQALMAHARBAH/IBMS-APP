import { describe, expect, it } from 'vitest';
import {
  DISPOSAL_METHODS,
  deriveDisposalBatchView,
  disposalBatchAuditSnapshot,
  type DisposalBatchRow,
} from './disposal-batch.config';

const row = (over: Partial<DisposalBatchRow> = {}): DisposalBatchRow => ({
  id: 'db-1',
  retentionScheduleItemId: 'rsi-1',
  status: 'NOMINATED',
  nominatedByUserId: 'u-manager',
  managerApprovedAt: null,
  dpoApprovedByUserId: null,
  dpoApprovedAt: null,
  method: null,
  executedAt: null,
  slaDueAt: null,
  createdAt: new Date('2026-09-14T00:00:00.000Z'),
  ...over,
});

describe('DISPOSAL_METHODS', () => {
  it('names the three documented destruction methods', () => {
    expect(DISPOSAL_METHODS).toEqual([
      'certified_secure_wipe_nist_800_88',
      'physical_destruction',
      'certified_shredding',
    ]);
  });
});

describe('deriveDisposalBatchView', () => {
  it('serialises timestamps and carries the certificate flag', () => {
    const v = deriveDisposalBatchView(
      row({
        status: 'EXECUTED',
        method: 'certified_shredding',
        executedAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
      true,
    );
    expect(v.status).toBe('EXECUTED');
    expect(v.executedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(v.hasCertificateOfDestruction).toBe(true);
  });

  it('reports no certificate for a freshly nominated batch', () => {
    const v = deriveDisposalBatchView(row(), false);
    expect(v.hasCertificateOfDestruction).toBe(false);
    expect(v.managerApprovedAt).toBeNull();
    expect(v.dpoApprovedAt).toBeNull();
  });
});

describe('disposalBatchAuditSnapshot', () => {
  it('carries ids and the maker/checker identities, not the method/certificate detail', () => {
    const snap = disposalBatchAuditSnapshot(
      row({ dpoApprovedByUserId: 'u-dpo', status: 'DPO_APPROVED' }),
    );
    expect(snap).toEqual({
      disposalBatchId: 'db-1',
      retentionScheduleItemId: 'rsi-1',
      status: 'DPO_APPROVED',
      nominatedByUserId: 'u-manager',
      dpoApprovedByUserId: 'u-dpo',
    });
  });
});
