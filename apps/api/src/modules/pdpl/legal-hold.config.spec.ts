import { describe, expect, it } from 'vitest';
import {
  deriveLegalHoldView,
  legalHoldAuditSnapshot,
  type LegalHoldRow,
} from './legal-hold.config';

const row = (over: Partial<LegalHoldRow> = {}): LegalHoldRow => ({
  id: 'lh-1',
  scope: 'Customer XYZ file — litigation ABC-2026-123',
  reason: 'Active litigation pending discovery.',
  placedAt: new Date('2026-09-14T00:00:00.000Z'),
  nextReviewDueAt: new Date('2027-03-14T00:00:00.000Z'),
  releasedAt: null,
  retentionScheduleItemId: 'rsi-1',
  ...over,
});

describe('deriveLegalHoldView', () => {
  it('is active when releasedAt is null', () => {
    const v = deriveLegalHoldView(row());
    expect(v.isActive).toBe(true);
    expect(v.releasedAt).toBeNull();
  });

  it('is not active once released', () => {
    const v = deriveLegalHoldView(
      row({ releasedAt: new Date('2026-10-01T00:00:00.000Z') }),
    );
    expect(v.isActive).toBe(false);
    expect(v.releasedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('legalHoldAuditSnapshot', () => {
  it("carries scope/reason verbatim — an operational note, not a data subject's own text (the DSR precedent)", () => {
    const snap = legalHoldAuditSnapshot(row());
    expect(snap).toEqual({
      legalHoldId: 'lh-1',
      scope: 'Customer XYZ file — litigation ABC-2026-123',
      reason: 'Active litigation pending discovery.',
      retentionScheduleItemId: 'rsi-1',
      isActive: true,
    });
  });
});
