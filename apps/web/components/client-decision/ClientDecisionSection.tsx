'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  captureClientDecision,
  listClientDecisionsForOpportunity,
  DECISION_TYPE_OPTIONS,
  EVIDENCE_TYPE_OPTIONS,
  type ClientDecision,
  type ClientDecisionType,
  type EvidenceType,
} from '../../lib/client-decision/client-decision-api';
import type { OpportunityWithContext } from '../../lib/opportunity/opportunity-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunity: OpportunityWithContext;
  canCapture: boolean;
  onOpportunityChanged: () => void;
}

const DECISION_STATES = new Set([
  'SENT_TO_CLIENT',
  'CLIENT_DECISION',
  'PLACEMENT',
  'CLOSED_LOST',
  'RENEGOTIATE',
]);

export function ClientDecisionSection({
  opportunity,
  canCapture,
  onOpportunityChanged,
}: Props) {
  const [decision, setDecision] = useState<ClientDecision | null | undefined>(
    undefined,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [decisionType, setDecisionType] =
    useState<ClientDecisionType>('ACCEPT');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('e-signature');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await listClientDecisionsForOpportunity(opportunity.id);
      setDecision(rows[0] ?? null);
      setLoadError(null);
    } catch (err) {
      setDecision(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the client decision — try again.',
      );
    }
  }, [opportunity.id]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function submit() {
    if (evidenceRef.trim().length < 2) {
      setFormError('An evidence reference is required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await captureClientDecision({
        opportunityId: opportunity.id,
        decision: decisionType,
        evidenceType,
        evidenceRef: evidenceRef.trim(),
        notes: notes.trim() || undefined,
      });
      await load();
      onOpportunityChanged();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Could not record the decision — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  // Nothing to show until a recommendation could have been sent.
  if (decision === undefined) {
    return (
      <section>
        <h2 style={{ marginTop: '2.5rem' }}>Client decision</h2>
        <p>Loading…</p>
      </section>
    );
  }
  if (decision === null && !DECISION_STATES.has(opportunity.status)) {
    return null;
  }

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>Client decision</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        One decision per opportunity. Accept → placement, Reject → close the
        request, any &ldquo;request&rdquo; → renewed negotiation.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {decision ? (
        <div style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <strong>
              {DECISION_TYPE_OPTIONS.find((o) => o.value === decision.decision)
                ?.label ?? decision.decision}
            </strong>
            <span style={rfqBadgeStyle}>
              {decision.routeLabel}
              {decision.routingComplete ? '' : ' (routing incomplete)'}
            </span>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            Evidence: {decision.evidenceType ?? '—'}
            {decision.evidenceRef ? ` · ${decision.evidenceRef}` : ''}
          </p>
          {decision.notes ? (
            <p style={{ whiteSpace: 'pre-wrap', margin: '0.4rem 0' }}>
              {decision.notes}
            </p>
          ) : null}
          <p style={{ opacity: 0.6, fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
            Recorded {new Date(decision.decidedAt).toLocaleString()} · opportunity
            now {decision.opportunityStatus}
          </p>
        </div>
      ) : canCapture ? (
        <div style={{ marginTop: '1rem', maxWidth: '36rem' }}>
          {formError ? (
            <p role="alert" style={errorStyle}>
              {formError}
            </p>
          ) : null}
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-decision">Decision</label>
            <select
              id="cd-decision"
              value={decisionType}
              onChange={(e) =>
                setDecisionType(e.target.value as ClientDecisionType)
              }
            >
              {DECISION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-evidence-type">Evidence type</label>
            <select
              id="cd-evidence-type"
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
            >
              {EVIDENCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-evidence-ref">Evidence reference</label>
            <input
              id="cd-evidence-ref"
              value={evidenceRef}
              maxLength={500}
              placeholder="document id / e-signature envelope / email ref"
              onChange={(e) => setEvidenceRef(e.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-notes">Notes (optional)</label>
            <textarea
              id="cd-notes"
              value={notes}
              rows={2}
              maxLength={8000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || evidenceRef.trim().length < 2}
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() => void submit()}
          >
            {busy ? 'Recording…' : 'Record client decision'}
          </button>
        </div>
      ) : (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          No client decision recorded yet.
        </p>
      )}
    </section>
  );
}
