import { describe, expect, it } from 'vitest';
import {
  consentAuditSnapshot,
  consentWithdrawalAuditSnapshot,
  deriveConsentView,
  hasExactlyOneOwner,
  type ConsentRecordRow,
} from './consent.config';

const row = (over: Partial<ConsentRecordRow> = {}): ConsentRecordRow => ({
  id: 'consent-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  purpose: 'MARKETING',
  isMarketing: true,
  granted: true,
  consentTextVersion: 'privacy-notice-v1.2',
  grantedAt: new Date('2026-09-04T09:00:00.000Z'),
  withdrawnAt: null,
  createdAt: new Date('2026-09-04T09:00:00.000Z'),
  ...over,
});

describe('deriveConsentView', () => {
  it('is active when granted and not withdrawn', () => {
    expect(deriveConsentView(row()).isActive).toBe(true);
  });

  it('is not active when never granted', () => {
    const v = deriveConsentView(row({ granted: false, grantedAt: null }));
    expect(v.isActive).toBe(false);
    expect(v.grantedAt).toBeNull();
  });

  it('is not active once withdrawn, even though granted stays true', () => {
    const v = deriveConsentView(
      row({ withdrawnAt: new Date('2026-09-05T00:00:00.000Z') }),
    );
    expect(v.granted).toBe(true);
    expect(v.isActive).toBe(false);
    expect(v.withdrawnAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('serialises null timestamps as null, not an empty string', () => {
    const v = deriveConsentView(row({ granted: false, grantedAt: null }));
    expect(v.grantedAt).toBeNull();
    expect(v.withdrawnAt).toBeNull();
  });
});

describe('hasExactlyOneOwner', () => {
  it('is true with only customerId', () => {
    expect(hasExactlyOneOwner({ customerId: 'cust-1' })).toBe(true);
  });

  it('is true with only insuredPersonId', () => {
    expect(hasExactlyOneOwner({ insuredPersonId: 'ip-1' })).toBe(true);
  });

  it('is false with neither', () => {
    expect(hasExactlyOneOwner({})).toBe(false);
  });

  it('is false with both', () => {
    expect(
      hasExactlyOneOwner({ customerId: 'cust-1', insuredPersonId: 'ip-1' }),
    ).toBe(false);
  });
});

describe('audit snapshots', () => {
  it('consentAuditSnapshot carries ids + the decision, no free text beyond the version label', () => {
    expect(
      consentAuditSnapshot({
        consentRecordId: 'consent-1',
        customerId: 'cust-1',
        insuredPersonId: null,
        purpose: 'MARKETING',
        isMarketing: true,
        granted: true,
        consentTextVersion: 'privacy-notice-v1.2',
      }),
    ).toEqual({
      consentRecordId: 'consent-1',
      customerId: 'cust-1',
      insuredPersonId: null,
      purpose: 'MARKETING',
      isMarketing: true,
      granted: true,
      consentTextVersion: 'privacy-notice-v1.2',
    });
  });

  it('consentWithdrawalAuditSnapshot carries only the withdrawal event', () => {
    const withdrawnAt = new Date('2026-09-06T12:00:00.000Z');
    expect(
      consentWithdrawalAuditSnapshot({
        consentRecordId: 'consent-1',
        customerId: 'cust-1',
        insuredPersonId: null,
        purpose: 'MARKETING',
        withdrawnAt,
      }),
    ).toEqual({
      consentRecordId: 'consent-1',
      customerId: 'cust-1',
      insuredPersonId: null,
      purpose: 'MARKETING',
      withdrawnAt: '2026-09-06T12:00:00.000Z',
    });
  });
});
