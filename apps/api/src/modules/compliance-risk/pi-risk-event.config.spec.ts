import { describe, expect, it } from 'vitest';
import {
  derivePiRiskEventView,
  piRiskEventAuditSnapshot,
  type PiRiskEventRow,
} from './pi-risk-event.config';

function row(overrides: Partial<PiRiskEventRow> = {}): PiRiskEventRow {
  return {
    id: 'event-1',
    piPolicyId: 'pi-1',
    sourcePolicyCheckingId: null,
    description: 'Requested Sum Insured did not match amount sent to insurer.',
    mitigationAction: null,
    loggedAt: new Date('2026-09-01T09:00:00.000Z'),
    ...overrides,
  };
}

describe('derivePiRiskEventView (Process 54)', () => {
  it('isAutoLogged is true only when sourcePolicyCheckingId is set', () => {
    expect(derivePiRiskEventView(row()).isAutoLogged).toBe(false);
    expect(
      derivePiRiskEventView(row({ sourcePolicyCheckingId: 'check-1' }))
        .isAutoLogged,
    ).toBe(true);
  });

  it('serializes a null piPolicyId / mitigationAction as null, not undefined', () => {
    const view = derivePiRiskEventView(row({ piPolicyId: null }));
    expect(view.piPolicyId).toBeNull();
    expect(view.mitigationAction).toBeNull();
  });
});

describe('piRiskEventAuditSnapshot (Process 54)', () => {
  it('carries ids/description/mitigation verbatim for a MANUAL entry', () => {
    const snapshot = piRiskEventAuditSnapshot(
      row({
        sourcePolicyCheckingId: null,
        mitigationAction: 'Re-issued schedule with corrected figures.',
      }),
    );
    expect(snapshot.piRiskEventId).toBe('event-1');
    expect(snapshot.description).toBe(
      'Requested Sum Insured did not match amount sent to insurer.',
    );
    expect(snapshot.mitigationAction).toBe(
      'Re-issued schedule with corrected figures.',
    );
  });

  it('redacts description for an AUTO-LOGGED entry (review-fix regression) — never re-embeds the coverage-figure diff the sibling PolicyChecking audit row deliberately excludes', () => {
    const snapshot = piRiskEventAuditSnapshot(
      row({
        sourcePolicyCheckingId: 'check-1',
        description:
          'Policy-checking discrepancy on policy POL-100: limits.buildings requested 9500000.000, issued 5000000.000',
        mitigationAction: 'Re-issued schedule with corrected figures.',
      }),
    );
    expect(snapshot.description).not.toContain('9500000.000');
    expect(snapshot.description).not.toContain('5000000.000');
    expect(snapshot.sourcePolicyCheckingId).toBe('check-1');
    // mitigationAction is Compliance's OWN fresh text, not derived from the
    // checking diff — it stays verbatim even on an auto-logged row.
    expect(snapshot.mitigationAction).toBe(
      'Re-issued schedule with corrected figures.',
    );
  });
});
