import { describe, expect, it } from 'vitest';
import {
  brokerLicenseAuditSnapshot,
  deriveBrokerLicenseView,
  isBrokerLicenseCurrentlyLapsed,
  type BrokerLicenseRow,
} from './broker-license.config';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function row(overrides: Partial<BrokerLicenseRow> = {}): BrokerLicenseRow {
  return {
    id: 'the-broker-license',
    licenseNumber: 'CBJ-2026-001',
    scopeOfAuthorization: 'General insurance brokerage',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    status: 'active',
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
