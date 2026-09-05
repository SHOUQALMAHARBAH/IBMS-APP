import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  derivePiPolicyView,
  isPiPolicyCurrentlyLapsed,
  piPolicyAuditSnapshot,
  type PiPolicyRow,
} from './pi-policy.config';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function row(overrides: Partial<PiPolicyRow> = {}): PiPolicyRow {
  return {
    id: 'pi-1',
    insurerName: 'Jordan Insurance Co.',
    coverageLimit: new Prisma.Decimal('1000000.000'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    claimsHistorySummary: null,
    ...overrides,
  };
}

describe('isPiPolicyCurrentlyLapsed (Process 53-54)', () => {
  it('is false when expiresAt is in the future', () => {
    expect(
      isPiPolicyCurrentlyLapsed(
        { expiresAt: new Date('2027-01-01T00:00:00.000Z') },
        NOW,
      ),
    ).toBe(false);
  });

  it('is true the instant expiresAt passes — no manual status field to combine with', () => {
    expect(
      isPiPolicyCurrentlyLapsed(
        { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
        NOW,
      ),
    ).toBe(true);
  });

  it('is true at the exact boundary (<=)', () => {
    expect(isPiPolicyCurrentlyLapsed({ expiresAt: NOW }, NOW)).toBe(true);
  });
});

describe('derivePiPolicyView (Process 53-54)', () => {
  it('flags isCurrent only for the id matching currentId', () => {
    const view = derivePiPolicyView(row({ id: 'pi-1' }), NOW, 'pi-1');
    expect(view.isCurrent).toBe(true);
    const other = derivePiPolicyView(row({ id: 'pi-2' }), NOW, 'pi-1');
    expect(other.isCurrent).toBe(false);
  });

  it('formats coverageLimit as a fixed 3dp string, not a Decimal object', () => {
    const view = derivePiPolicyView(
      row({ coverageLimit: new Prisma.Decimal('500000') }),
      NOW,
      null,
    );
    expect(view.coverageLimit).toBe('500000.000');
  });

  it('serializes a null claimsHistorySummary as null', () => {
    const view = derivePiPolicyView(row(), NOW, null);
    expect(view.claimsHistorySummary).toBeNull();
  });
});

describe('piPolicyAuditSnapshot (Process 53-54)', () => {
  it('carries ids/insurer/coverage/expiry/claims-history verbatim', () => {
    const snapshot = piPolicyAuditSnapshot(
      row({ claimsHistorySummary: 'One minor claim, settled 2025.' }),
    );
    expect(snapshot.piPolicyId).toBe('pi-1');
    expect(snapshot.insurerName).toBe('Jordan Insurance Co.');
    expect(snapshot.coverageLimit).toBe('1000000.000');
    expect(snapshot.claimsHistorySummary).toBe(
      'One minor claim, settled 2025.',
    );
  });
});
