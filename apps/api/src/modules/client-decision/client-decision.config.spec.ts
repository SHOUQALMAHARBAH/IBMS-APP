import { describe, expect, it } from 'vitest';
import {
  CLIENT_DECISION_ROUTES,
  clientDecisionAuditSnapshot,
  routeFor,
  routeLabel,
} from './client-decision.config';

describe('routeFor', () => {
  it('routes ACCEPT to placement', () => {
    expect(routeFor('ACCEPT')).toBe('PLACEMENT');
  });
  it('routes REJECT to closing the request', () => {
    expect(routeFor('REJECT')).toBe('CLOSED_LOST');
  });
  it('routes every REQUEST_* value to renewed negotiation', () => {
    expect(routeFor('REQUEST_FURTHER_NEGOTIATION')).toBe('RENEGOTIATE');
    expect(routeFor('REQUEST_ALTERNATIVE_OPTIONS')).toBe('RENEGOTIATE');
    expect(routeFor('REQUEST_PRICE_REDUCTION')).toBe('RENEGOTIATE');
    expect(routeFor('REQUEST_COVERAGE_INCREASE')).toBe('RENEGOTIATE');
  });
  it('covers all six decision types, mapping to exactly three routes', () => {
    const keys = Object.keys(CLIENT_DECISION_ROUTES);
    expect(keys).toHaveLength(6);
    expect(new Set(Object.values(CLIENT_DECISION_ROUTES))).toEqual(
      new Set(['PLACEMENT', 'CLOSED_LOST', 'RENEGOTIATE']),
    );
  });
});

describe('routeLabel', () => {
  it('gives a human label per route', () => {
    expect(routeLabel('PLACEMENT')).toBe('Proceed to placement');
    expect(routeLabel('CLOSED_LOST')).toBe('Close the request');
    expect(routeLabel('RENEGOTIATE')).toBe('Renewed negotiation');
  });
});

describe('clientDecisionAuditSnapshot', () => {
  const row = {
    opportunityId: 'opp-1',
    decision: 'REQUEST_PRICE_REDUCTION' as const,
    evidenceType: 'email_confirmation',
    evidenceRef: 'msg-8842',
    capturedByUserId: 'sales-1',
    notes: 'Client wants the premium down ~8% before signing.',
  };

  it('carries the decision, its route, and the evidence type + ref', () => {
    const snap = clientDecisionAuditSnapshot(row);
    expect(snap).toMatchObject({
      opportunityId: 'opp-1',
      decision: 'REQUEST_PRICE_REDUCTION',
      route: 'RENEGOTIATE',
      evidenceType: 'email_confirmation',
      evidenceRef: 'msg-8842',
      capturedByUserId: 'sales-1',
      hasNotes: true,
    });
  });

  it('never carries the free-text notes, only a presence boolean', () => {
    const snap = clientDecisionAuditSnapshot(row);
    expect(JSON.stringify(snap)).not.toContain('premium down');
    expect(clientDecisionAuditSnapshot({ ...row, notes: null })).toMatchObject({
      hasNotes: false,
    });
    expect(clientDecisionAuditSnapshot({ ...row, notes: '   ' })).toMatchObject(
      {
        hasNotes: false,
      },
    );
  });
});
