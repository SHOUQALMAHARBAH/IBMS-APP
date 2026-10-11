import { describe, expect, it } from 'vitest';
import {
  brokerLicenseAuditSnapshot,
  deriveBrokerLicenseView,
  isBrokerLicenseCurrentlyLapsed,
  pickCurrentTerm,
  type BrokerLicenseRow,
} from './broker-license.config';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function row(overrides: Partial<BrokerLicenseRow> = {}): BrokerLicenseRow {
  return {
    // A uuid-shaped id, not `the-broker-license`: Module 0 item (c) retired that constant, which
    // had been the table's PRIMARY KEY and therefore allowed one licence row per PLATFORM.
    id: 'b1f0c0de-0000-4000-8000-000000000001',
    licenseNumber: 'CBJ-2026-001',
    scopeOfAuthorization: 'General insurance brokerage',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    status: 'active',
    certificateDocumentId: 'doc-certificate-1',
    renewalRequestedAt: null,
    ...overrides,
  };
}

describe('isBrokerLicenseCurrentlyLapsed (Process 51)', () => {
  it('is not lapsed while active and before expiry', () => {
    expect(isBrokerLicenseCurrentlyLapsed(row(), NOW)).toBe(false);
  });

  it('is lapsed once expiresAt has passed, even if status still reads active', () => {
    expect(
      isBrokerLicenseCurrentlyLapsed(
        row({ expiresAt: new Date('2026-01-01T00:00:00.000Z') }),
        NOW,
      ),
    ).toBe(true);
  });

  it('is lapsed exactly at the expiry instant (inclusive boundary)', () => {
    expect(isBrokerLicenseCurrentlyLapsed(row({ expiresAt: NOW }), NOW)).toBe(
      true,
    );
  });

  it('is lapsed when manually marked lapsed, even with a future expiry', () => {
    expect(isBrokerLicenseCurrentlyLapsed(row({ status: 'lapsed' }), NOW)).toBe(
      true,
    );
  });
});

describe('deriveBrokerLicenseView (Process 51)', () => {
  it('carries the live-derived isCurrentlyLapsed alongside the raw stored status', () => {
    const view = deriveBrokerLicenseView(
      row({
        status: 'active',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      NOW,
    );
    expect(view.status).toBe('active');
    expect(view.isCurrentlyLapsed).toBe(true);
  });

  it('serializes null issuedAt/scopeOfAuthorization as null, not undefined', () => {
    const view = deriveBrokerLicenseView(
      row({ issuedAt: null, scopeOfAuthorization: null }),
      NOW,
    );
    expect(view.issuedAt).toBeNull();
    expect(view.scopeOfAuthorization).toBeNull();
  });
});

describe('brokerLicenseAuditSnapshot (Process 51)', () => {
  it('includes scopeOfAuthorization verbatim (not customer data, no guard needed)', () => {
    const snapshot = brokerLicenseAuditSnapshot(row());
    expect(snapshot.scopeOfAuthorization).toBe('General insurance brokerage');
    expect(snapshot.licenseNumber).toBe('CBJ-2026-001');
    expect(snapshot.status).toBe('active');
  });
});

describe('pickCurrentTerm (Module 0 item c)', () => {
  it('is null for an office with no terms', () => {
    // NOT the same as "not blocked" — `PolicyService.assertLicenseNotLapsed` refuses on this.
    expect(pickCurrentTerm([])).toBeNull();
  });

  it('picks the term with the LATEST expiry, whatever order they arrive in', () => {
    const older = row({ id: 'older', expiresAt: new Date('2025-12-31') });
    const newer = row({ id: 'newer', expiresAt: new Date('2028-12-31') });
    expect(pickCurrentTerm([older, newer])?.id).toBe('newer');
    expect(pickCurrentTerm([newer, older])?.id).toBe('newer');
  });

  it('prefers the newer term even while the older one still covers today', () => {
    // The case the choice exists for. A renewal is filed 45 days before expiry (art. 11), so an
    // office legitimately holds two terms at once; "the term covering today" would answer with the
    // outgoing one and report an office as lapsing when it has already been renewed.
    const outgoing = row({ id: 'outgoing', expiresAt: new Date('2026-12-31') });
    const incoming = row({
      id: 'incoming',
      issuedAt: new Date('2026-11-15'),
      expiresAt: new Date('2029-12-31'),
    });
    const duringTheOverlap = new Date('2026-12-01T00:00:00.000Z');
    const current = pickCurrentTerm([outgoing, incoming]);
    expect(current?.id).toBe('incoming');
    expect(isBrokerLicenseCurrentlyLapsed(current!, duringTheOverlap)).toBe(
      false,
    );
  });
});
