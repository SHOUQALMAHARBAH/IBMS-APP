import { describe, expect, it } from 'vitest';
import {
  buildPolicyDashboardSummary,
  DEFAULT_RENEWAL_WINDOW_DAYS,
} from './policy-dashboard.config';

describe('DEFAULT_RENEWAL_WINDOW_DAYS', () => {
  it('matches RenewalCase.leadTimeDays own default (90)', () => {
    expect(DEFAULT_RENEWAL_WINDOW_DAYS).toBe(90);
  });
});

describe('buildPolicyDashboardSummary', () => {
  it('composes every section from the raw inputs', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const period = {
      periodLabel: '2026-08',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    };
    const summary = buildPolicyDashboardSummary({
      now,
      period,
      renewalWindowDays: 90,
      activePoliciesCount: 120,
      expiringPoliciesCount: 8,
      newPoliciesIssuedCount: 15,
      cancelledPolicies: [
        {
          policyId: 'pol-1',
          policyNumber: 'POL-001',
          insuranceLine: 'property',
          reason: 'Client sold the insured property.',
          cancelledAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    });
    expect(summary.generatedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(summary.periodLabel).toBe('2026-08');
    expect(summary.renewalWindowDays).toBe(90);
    expect(summary.activePoliciesCount).toBe(120);
    expect(summary.expiringPoliciesCount).toBe(8);
    expect(summary.newPoliciesIssuedCount).toBe(15);
    expect(summary.cancelledPolicies).toHaveLength(1);
    expect(summary.cancelledPolicies[0].reason).toBe(
      'Client sold the insured property.',
    );
  });

  it('allows an empty cancelled-policies list', () => {
    const summary = buildPolicyDashboardSummary({
      now: new Date('2026-09-07T00:00:00.000Z'),
      period: {
        periodLabel: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
      renewalWindowDays: 90,
      activePoliciesCount: 0,
      expiringPoliciesCount: 0,
      newPoliciesIssuedCount: 0,
      cancelledPolicies: [],
    });
    expect(summary.cancelledPolicies).toEqual([]);
  });
});
