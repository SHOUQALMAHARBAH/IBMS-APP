import { describe, expect, it } from 'vitest';
import {
  buildPolicyDashboardSummary,
  DEFAULT_RENEWAL_WINDOW_DAYS,
  POLICY_DASHBOARD_METRIC_SCOPE,
} from './policy-dashboard.config';

describe('DEFAULT_RENEWAL_WINDOW_DAYS', () => {
  it('matches RenewalCase.leadTimeDays own default (90)', () => {
    expect(DEFAULT_RENEWAL_WINDOW_DAYS).toBe(90);
  });
});

/*
 * OWNER DECISION 58 — WHICH FIGURES OBEY THE PERIOD, and this block exists because a
 * plant proved the declaration was unobserved: flipping `activePoliciesCount` to
 * `'period'` left the Playwright spec at 4/4 (its fixture supplies `metricScope`
 * itself, so a mock cannot corrupt what the api declares) and this spec at 3/3.
 *
 * The declaration is what makes the two clauses correct, so a wrong value here puts a
 * period beside a figure that ignores it — a confident false sentence rather than the
 * bare number decision 58 removes.
 */
describe('POLICY_DASHBOARD_METRIC_SCOPE (owner decision 58)', () => {
  it('declares the two LIVE SNAPSHOTS as `asOf` — they read Policy.status and Policy.expiryDate as of now, whatever period is chosen', () => {
    // This file's own header calls it «a deliberate asymmetry, not an oversight», and
    // these two assertions are that sentence in the form that can fail.
    expect(POLICY_DASHBOARD_METRIC_SCOPE.activePoliciesCount).toBe('asOf');
    expect(POLICY_DASHBOARD_METRIC_SCOPE.expiringPoliciesCount).toBe('asOf');
  });

  it('declares the two EVENT counts as `period` — they scope by their own date field within the window', () => {
    expect(POLICY_DASHBOARD_METRIC_SCOPE.newPoliciesIssuedCount).toBe('period');
    expect(POLICY_DASHBOARD_METRIC_SCOPE.cancelledPolicies).toBe('period');
  });

  it('is a MIXED declaration, which is the whole reason it is shipped on the wire', () => {
    /*
     * THE FLOOR, and it is the assertion that outlives the four above. A declaration
     * where every value agrees could be replaced by a screen-side assumption and
     * nothing would notice; it is because THIS screen mixes the two that the choice
     * has to come from the server. If this ever becomes uniform, the mechanism needs
     * re-arguing rather than quietly keeping a field nothing varies.
     */
    const values = new Set(Object.values(POLICY_DASHBOARD_METRIC_SCOPE));
    expect(values).toEqual(new Set(['asOf', 'period']));
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
          // Owner decision 50 — the name a policy with no number is shown by instead of its id.
          customerName: 'شركة اليرموك للتأمين',
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
