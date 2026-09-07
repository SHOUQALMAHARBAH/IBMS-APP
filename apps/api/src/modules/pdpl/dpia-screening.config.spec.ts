import { describe, expect, it } from 'vitest';
import {
  computeDpiaOutcome,
  deriveDpiaScreeningView,
  dpiaScreeningAuditSnapshot,
  type DpiaScreeningRow,
} from './dpia-screening.config';

const ALL_NO = {
  qSensitiveData: false,
  qLargeScaleProcessing: false,
  qCrossBorderTransfer: false,
  qNewTechnologyMonitoring: false,
  qNewDigitalChannel: false,
};

describe('computeDpiaOutcome', () => {
  it('auto-approves when every answer is No', () => {
    expect(computeDpiaOutcome(ALL_NO)).toBe('AUTO_APPROVED');
  });

  it('requires DPO review when any single answer is Yes', () => {
    expect(computeDpiaOutcome({ ...ALL_NO, qSensitiveData: true })).toBe(
      'DPO_REVIEW_REQUIRED',
    );
    expect(computeDpiaOutcome({ ...ALL_NO, qNewDigitalChannel: true })).toBe(
      'DPO_REVIEW_REQUIRED',
    );
  });

  it('requires DPO review when every answer is Yes', () => {
    expect(
      computeDpiaOutcome({
        qSensitiveData: true,
        qLargeScaleProcessing: true,
        qCrossBorderTransfer: true,
        qNewTechnologyMonitoring: true,
        qNewDigitalChannel: true,
      }),
    ).toBe('DPO_REVIEW_REQUIRED');
  });
});

const row = (over: Partial<DpiaScreeningRow> = {}): DpiaScreeningRow => ({
  id: 'dpia-1',
  subjectDescription: 'New mobile claims-photo upload feature.',
  ...ALL_NO,
  outcome: 'AUTO_APPROVED',
  dpoReviewDueAt: null,
  dpoReviewedAt: null,
  dpoSpotCheckedAt: null,
  escalatedToFullDpiaAt: null,
  createdAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

describe('deriveDpiaScreeningView', () => {
  it('serializes nullable timestamps', () => {
    const v = deriveDpiaScreeningView(row());
    expect(v.dpoReviewDueAt).toBeNull();
    expect(v.outcome).toBe('AUTO_APPROVED');
  });

  it('serializes a set dpoReviewDueAt', () => {
    const v = deriveDpiaScreeningView(
      row({
        outcome: 'DPO_REVIEW_REQUIRED',
        dpoReviewDueAt: new Date('2026-09-14T00:00:00.000Z'),
      }),
    );
    expect(v.dpoReviewDueAt).toBe('2026-09-14T00:00:00.000Z');
  });
});

describe('dpiaScreeningAuditSnapshot', () => {
  it('includes the subject description and the 5 answers', () => {
    const snap = dpiaScreeningAuditSnapshot(
      row({ qCrossBorderTransfer: true }),
    );
    expect(snap).toMatchObject({
      dpiaScreeningId: 'dpia-1',
      subjectDescription: 'New mobile claims-photo upload feature.',
      qCrossBorderTransfer: true,
    });
  });
});
