import { describe, expect, it } from 'vitest';
import {
  deriveRiskRegisterItemView,
  riskRegisterItemAuditSnapshot,
  RISK_REGISTER_TYPES,
  type RiskRegisterItemRow,
} from './risk-register.config';

function row(
  overrides: Partial<RiskRegisterItemRow> = {},
): RiskRegisterItemRow {
  return {
    id: 'risk-1',
    riskType: 'operational',
    description: 'A recurring policy-issuance data-entry error.',
    mitigationAction: null,
    status: 'open',
    loggedAt: new Date('2026-09-01T09:00:00.000Z'),
    closedAt: null,
    ...overrides,
  };
}

describe('RISK_REGISTER_TYPES (Process 53)', () => {
  it('is exactly the five non-PI categories the source names', () => {
    expect([...RISK_REGISTER_TYPES]).toEqual([
      'operational',
      'cyber',
      'financial',
      'compliance',
      'reputational',
    ]);
  });

  it('does not include professional indemnity — it has its own deeper model', () => {
    expect(RISK_REGISTER_TYPES).not.toContain('professional_indemnity');
    expect(RISK_REGISTER_TYPES).not.toContain('pi');
  });
});

describe('deriveRiskRegisterItemView (Process 53)', () => {
  it('serializes null mitigationAction / closedAt as null', () => {
    const view = deriveRiskRegisterItemView(row());
    expect(view.mitigationAction).toBeNull();
    expect(view.closedAt).toBeNull();
  });

  it('carries a closed item through with its closedAt timestamp', () => {
    const view = deriveRiskRegisterItemView(
      row({ status: 'closed', closedAt: new Date('2026-09-10T00:00:00.000Z') }),
    );
    expect(view.status).toBe('closed');
    expect(view.closedAt).toBe('2026-09-10T00:00:00.000Z');
  });
});

describe('riskRegisterItemAuditSnapshot (Process 53)', () => {
  it('carries riskType/description/mitigation/status verbatim', () => {
    const snapshot = riskRegisterItemAuditSnapshot(
      row({ mitigationAction: 'Added a second reviewer.' }),
    );
    expect(snapshot.riskType).toBe('operational');
    expect(snapshot.description).toBe(
      'A recurring policy-issuance data-entry error.',
    );
    expect(snapshot.mitigationAction).toBe('Added a second reviewer.');
    expect(snapshot.status).toBe('open');
  });
});
