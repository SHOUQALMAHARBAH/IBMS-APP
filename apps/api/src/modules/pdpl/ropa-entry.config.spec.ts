import { describe, expect, it } from 'vitest';
import {
  deriveRopaEntryView,
  ropaEntryAuditSnapshot,
  ropaExportAuditSnapshot,
  type RopaEntryRow,
} from './ropa-entry.config';

const row = (over: Partial<RopaEntryRow> = {}): RopaEntryRow => ({
  id: 'ropa-1',
  processingActivity: 'KYC identity verification',
  categoriesOfData: ['national_id', 'contact_details'],
  purpose: 'Regulatory KYC compliance',
  recipients: ['Internal Compliance team'],
  retentionPeriodMonths: 120,
  updatedAt: new Date('2026-09-07T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

describe('deriveRopaEntryView', () => {
  it('passes through arrays and serializes dates', () => {
    const v = deriveRopaEntryView(row());
    expect(v.categoriesOfData).toEqual(['national_id', 'contact_details']);
    expect(v.updatedAt).toBe('2026-09-07T00:00:00.000Z');
  });

  it('allows a null retentionPeriodMonths', () => {
    const v = deriveRopaEntryView(row({ retentionPeriodMonths: null }));
    expect(v.retentionPeriodMonths).toBeNull();
  });
});

describe('ropaEntryAuditSnapshot', () => {
  it('includes the full processing-activity description', () => {
    const snap = ropaEntryAuditSnapshot(row());
    expect(snap).toMatchObject({
      ropaEntryId: 'ropa-1',
      processingActivity: 'KYC identity verification',
      purpose: 'Regulatory KYC compliance',
    });
  });
});

describe('ropaExportAuditSnapshot', () => {
  it('records only the count and timestamp, not the full register', () => {
    const snap = ropaExportAuditSnapshot({
      generatedAt: '2026-09-07T00:00:00.000Z',
      entryCount: 3,
      entries: [],
    });
    expect(snap).toEqual({
      generatedAt: '2026-09-07T00:00:00.000Z',
      entryCount: 3,
    });
  });
});
