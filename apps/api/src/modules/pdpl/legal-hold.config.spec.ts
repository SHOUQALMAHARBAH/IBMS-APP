import { describe, expect, it } from 'vitest';
import {
  deriveLegalHoldView,
  hasAtMostOneSubjectReference,
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
  customerId: null,
  insuredPersonId: null,
  ...over,
});

describe('hasAtMostOneSubjectReference', () => {
  it('allows neither set (a category- or scope-text-only hold)', () => {
    expect(hasAtMostOneSubjectReference({})).toBe(true);
  });

  it('allows exactly one set', () => {
    expect(hasAtMostOneSubjectReference({ customerId: 'cust-1' })).toBe(true);
    expect(
      hasAtMostOneSubjectReference({ insuredPersonId: 'ip-1' }),
    ).toBe(true);
  });

  it('rejects both set — ambiguous which one names the subject', () => {
    expect(
      hasAtMostOneSubjectReference({
        customerId: 'cust-1',
        insuredPersonId: 'ip-1',
      }),
    ).toBe(false);
  });
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

  it('carries the subject reference through, when set', () => {
    const v = deriveLegalHoldView(row({ customerId: 'cust-1' }));
    expect(v.customerId).toBe('cust-1');
    expect(v.insuredPersonId).toBeNull();
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
      customerId: null,
      insuredPersonId: null,
      isActive: true,
    });
  });

  it('carries the subject reference into the audit snapshot, when set', () => {
    const snap = legalHoldAuditSnapshot(row({ customerId: 'cust-1' }));
    expect(snap).toMatchObject({ customerId: 'cust-1', insuredPersonId: null });
  });
});
