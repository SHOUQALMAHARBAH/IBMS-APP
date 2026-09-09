import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  DEFAULT_RENEWAL_LEAD_TIME_DAYS,
  deriveRenewalCaseView,
  isOpenRenewalStatus,
  renewalDueAt,
} from './renewal.config';
import type { RenewalCaseWithContext } from '../../repositories/renewal-case.repository';

const d = (v: string) => new Prisma.Decimal(v);

function caseFixture(
  over: Record<string, unknown> = {},
): RenewalCaseWithContext {
  return {
    id: 'rc-1',
    policyId: 'pol-1',
    status: 'RENEWAL_DUE',
    leadTimeDays: 90,
    triggeredAt: new Date('2026-09-01T00:00:00.000Z'),
    riskChangedSinceLastRenewal: false,
    insurerTermsWorsened: false,
    retentionEscalatedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    policy: {
      id: 'pol-1',
      customerId: 'cust-1',
      policyNumber: 'POL-0001',
      insuranceLine: 'Property All Risks',
      insurerId: 'ins-1',
      status: 'ACTIVE',
      inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
      expiryDate: new Date('2026-12-31T00:00:00.000Z'),
      issuedPremium: d('1000.000'),
      requestedPremium: d('1000.000'),
      customer: { legalName: 'Acme Ltd' },
    },
    lossRatio: null,
    ...over,
  } as unknown as RenewalCaseWithContext;
}

describe('renewalDueAt (Part 3.9 lead time)', () => {
  it('counts the lead time BACK from expiry, not forward from now', () => {
    const due = renewalDueAt(new Date('2026-12-31T00:00:00.000Z'), 90);
    // 2026-12-31 minus 90 days = 2026-10-02.
    expect(due?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('honours a non-default lead time', () => {
    const due = renewalDueAt(new Date('2026-12-31T00:00:00.000Z'), 30);
    expect(due?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('is null for a policy with no expiry date — nothing to renew against', () => {
    expect(renewalDueAt(null, DEFAULT_RENEWAL_LEAD_TIME_DAYS)).toBeNull();
  });
});

describe('isOpenRenewalStatus', () => {
  it('treats every pre-conclusion status as open', () => {
    for (const s of [
      'RENEWAL_DUE',
      'IN_PROGRESS',
      'QUOTES_OBTAINED',
      'RECOMMENDED',
      'CLIENT_DECISION',
    ] as const) {
      expect(isOpenRenewalStatus(s)).toBe(true);
    }
  });

  it('treats the three terminal statuses as closed', () => {
    for (const s of ['RENEWED', 'LAPSED', 'CANCELLED'] as const) {
      expect(isOpenRenewalStatus(s)).toBe(false);
    }
  });
});

describe('deriveRenewalCaseView', () => {
  it('projects the policy context and flags the case as open', () => {
    const v = deriveRenewalCaseView(caseFixture());
    expect(v.customerLegalName).toBe('Acme Ltd');
    expect(v.policyNumber).toBe('POL-0001');
    expect(v.open).toBe(true);
    expect(v.requiresRemarketing).toBe(false);
    expect(v.lossRatio).toBeNull();
  });

  it('derives requiresRemarketing from either trigger flag', () => {
    expect(
      deriveRenewalCaseView(caseFixture({ riskChangedSinceLastRenewal: true }))
        .requiresRemarketing,
    ).toBe(true);
    expect(
      deriveRenewalCaseView(caseFixture({ insurerTermsWorsened: true }))
        .requiresRemarketing,
    ).toBe(true);
  });

  it('renders the loss ratio at the precision its Decimal(7,4) column carries', () => {
    const v = deriveRenewalCaseView(
      caseFixture({
        lossRatio: {
          id: 'lr-1',
          renewalCaseId: 'rc-1',
          periodClaims: d('250.000'),
          periodPremium: d('1000.000'),
          ratio: new Prisma.Decimal('0.25'),
        },
      }),
    );
    expect(v.lossRatio).toEqual({
      periodClaims: '250.000',
      periodPremium: '1000.000',
      ratio: '0.2500',
    });
  });

  it('marks a RENEWED case closed', () => {
    expect(deriveRenewalCaseView(caseFixture({ status: 'RENEWED' })).open).toBe(
      false,
    );
  });
});
