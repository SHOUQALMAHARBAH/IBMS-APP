import { describe, expect, it } from 'vitest';
import {
  BCP_DR_SCENARIOS,
  computeScenarioCoverage,
  isTestOverdue,
  type BcpDrPlanRow,
} from './bcp-dr-plan.config';

function plan(over: Partial<BcpDrPlanRow> = {}): BcpDrPlanRow {
  return {
    id: 'plan-1',
    scenario: 'system_outage',
    planDocumentId: null,
    rtoHours: 4,
    rpoHours: 24,
    lastTestedAt: null,
    nextTestDueAt: null,
    ...over,
  };
}

describe('isTestOverdue', () => {
  it('is false when never scheduled', () => {
    expect(isTestOverdue(null)).toBe(false);
  });

  it('is false when the due date is in the future', () => {
    const now = new Date('2026-09-06T00:00:00.000Z');
    expect(isTestOverdue(new Date('2026-10-01T00:00:00.000Z'), now)).toBe(
      false,
    );
  });

  it('is true when the due date has passed', () => {
    const now = new Date('2026-09-06T00:00:00.000Z');
    expect(isTestOverdue(new Date('2026-08-01T00:00:00.000Z'), now)).toBe(true);
  });
});

describe('computeScenarioCoverage', () => {
  it('returns all five named scenarios, even with zero plans', () => {
    const coverage = computeScenarioCoverage([]);
    expect(coverage.map((c) => c.scenario)).toEqual([...BCP_DR_SCENARIOS]);
    expect(coverage.every((c) => c.hasPlan === false)).toBe(true);
  });

  it('flags a scenario as covered once a plan exists for it', () => {
    const coverage = computeScenarioCoverage([
      plan({ scenario: 'system_outage' }),
    ]);
    const outage = coverage.find((c) => c.scenario === 'system_outage');
    const cyber = coverage.find((c) => c.scenario === 'cyberattack_ransomware');
    expect(outage?.hasPlan).toBe(true);
    expect(outage?.plans).toHaveLength(1);
    expect(cyber?.hasPlan).toBe(false);
    expect(cyber?.plans).toHaveLength(0);
  });

  it('groups multiple plans under the same scenario', () => {
    const coverage = computeScenarioCoverage([
      plan({ id: 'plan-1', scenario: 'key_staff_unavailability' }),
      plan({ id: 'plan-2', scenario: 'key_staff_unavailability' }),
    ]);
    const staff = coverage.find(
      (c) => c.scenario === 'key_staff_unavailability',
    );
    expect(staff?.plans).toHaveLength(2);
  });
});
