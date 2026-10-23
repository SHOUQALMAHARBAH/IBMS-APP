import { describe, expect, it } from 'vitest';
import {
  consentAuditSnapshot,
  consentWithdrawalAuditSnapshot,
  deriveConsentView,
  hasExactlyOneConsentOwner,
  type ConsentRecordRow,
} from './consent.config';

// hasExactlyOneOwner moved to common/dto.util.ts (also needed by
// dsr.config.ts, Process 52/M04) — its tests moved with it to
// common/dto.util.spec.ts; consent.config.ts re-exports the function so
// existing `from './consent.config'` imports keep working.

const row = (over: Partial<ConsentRecordRow> = {}): ConsentRecordRow => ({
  id: 'consent-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  leadId: null,
  purpose: 'MARKETING',
  isMarketing: true,
  granted: true,
  consentTextVersion: 'privacy-notice-v1.2',
  grantedAt: new Date('2026-09-04T09:00:00.000Z'),
  withdrawnAt: null,
  createdAt: new Date('2026-09-04T09:00:00.000Z'),
  // Batch six item 2 — the default fixture names a CUSTOMER, so that relation carries a name and
  // the other two are absent, which is the shape the service enforces (at most one subject).
  customer: { legalName: 'شركة اليرموك للتأمين' },
  lead: null,
  insuredPerson: null,
  ...over,
});

describe('hasExactlyOneConsentOwner', () => {
  it('is true for exactly one of customerId / insuredPersonId / leadId', () => {
    expect(hasExactlyOneConsentOwner({ customerId: 'cust-1' })).toBe(true);
    expect(hasExactlyOneConsentOwner({ insuredPersonId: 'ip-1' })).toBe(true);
    expect(hasExactlyOneConsentOwner({ leadId: 'lead-1' })).toBe(true);
  });

  it('is false when none are set', () => {
    expect(hasExactlyOneConsentOwner({})).toBe(false);
  });

  it('is false when two or all three are set', () => {
    expect(
      hasExactlyOneConsentOwner({ customerId: 'cust-1', leadId: 'lead-1' }),
    ).toBe(false);
    expect(
      hasExactlyOneConsentOwner({
        customerId: 'cust-1',
        insuredPersonId: 'ip-1',
        leadId: 'lead-1',
      }),
    ).toBe(false);
  });
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

  /*
   * BATCH SIX ITEM 2, RULE 2 — the register's Subject column rendered `Lead <8 chars of a uuid>` or
   * a bare sliced uuid. All THREE subject kinds are asserted, because the mapper is a `??` chain and
   * a chain that reached only its first link would pass a test that exercised only a customer.
   */
  it('names a CUSTOMER subject', () => {
    expect(deriveConsentView(row()).subjectName).toBe('شركة اليرموك للتأمين');
  });

  it('names a LEAD subject — the touchpoint that pre-dates the customer record', () => {
    const v = deriveConsentView(
      row({
        customerId: null,
        customer: null,
        leadId: 'lead-1',
        lead: { fullName: 'سامر عبدالله' },
      }),
    );
    expect(v.subjectName).toBe('سامر عبدالله');
    // the id stays on the wire, so the screen can still say WHICH kind this is
    expect(v.leadId).toBe('lead-1');
  });

  it('names an INSURED PERSON subject', () => {
    expect(
      deriveConsentView(
        row({
          customerId: null,
          customer: null,
          insuredPersonId: 'ip-1',
          insuredPerson: { fullName: 'ليلى حسن' },
        }),
      ).subjectName,
    ).toBe('ليلى حسن');
  });

  it('reports no name when the record names no subject at all', () => {
    expect(
      deriveConsentView(row({ customerId: null, customer: null })).subjectName,
    ).toBeNull();
  });

  it('serialises null timestamps as null, not an empty string', () => {
    const v = deriveConsentView(row({ granted: false, grantedAt: null }));
    expect(v.grantedAt).toBeNull();
    expect(v.withdrawnAt).toBeNull();
  });
});

describe('audit snapshots', () => {
  it('consentAuditSnapshot carries ids + the decision, no free text beyond the version label', () => {
    expect(
      consentAuditSnapshot({
        consentRecordId: 'consent-1',
        customerId: 'cust-1',
        insuredPersonId: null,
        leadId: null,
        purpose: 'MARKETING',
        isMarketing: true,
        granted: true,
        consentTextVersion: 'privacy-notice-v1.2',
      }),
    ).toEqual({
      consentRecordId: 'consent-1',
      customerId: 'cust-1',
      insuredPersonId: null,
      leadId: null,
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
