'use client';

import { useState } from 'react';
import {
  approveNeedsAssessment,
  rejectNeedsAssessment,
  returnNeedsAssessment,
  reviewNeedsAssessment,
  type NeedsAssessment,
} from '../../lib/needs-assessment/needs-assessment-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../auth/auth-form.styles';
import { reviewActionsStyle, reviewPanelStyle } from './needs-assessment.styles';

interface NeedsAssessmentReviewPanelProps {
  assessment: NeedsAssessment;
  onChanged: (assessment: NeedsAssessment) => void;
}

/** The Branch/Department Manager's review + approval controls
 * (needs-assessment.approve). Rendered only for a PENDING_REVIEW or REVIEWED
 * assessment. A reason is required to return for changes or to reject — the
 * backend enforces it too. Maker/checker (the manager can't be the officer
 * who captured it) is enforced server-side; a violation surfaces here as
 * the API's 403 message. */
export function NeedsAssessmentReviewPanel({
  assessment,
  onChanged,
}: NeedsAssessmentReviewPanelProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(action: string, fn: () => Promise<NeedsAssessment>) {
    setError(null);
    setBusy(action);
    try {
      onChanged(await fn());
      setReason('');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not complete that action — try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  const needsReason = reason.trim().length === 0;

  return (
    <section style={reviewPanelStyle} aria-label="Review and approval">
      <h2 style={{ marginTop: 0 }}>Review &amp; approval</h2>
      <p style={{ opacity: 0.8 }}>
        {assessment.status === 'PENDING_REVIEW'
          ? 'Record your review of the recommended cover, then approve or reject it. It cannot be linked to an opportunity or RFQ until approved.'
          : 'This assessment has been reviewed. Approve it to release it, or send it back for changes.'}
      </p>

      <div style={reviewActionsStyle}>
        {assessment.status === 'PENDING_REVIEW' ? (
          <button
            type="button"
            disabled={busy !== null}
            style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
            onClick={() =>
              void run('review', () => reviewNeedsAssessment(assessment.id))
            }
          >
            {busy === 'review' ? 'Recording…' : 'Mark reviewed'}
          </button>
        ) : null}
        {assessment.status === 'REVIEWED' ? (
          <button
            type="button"
            disabled={busy !== null}
            style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
            onClick={() =>
              void run('approve', () => approveNeedsAssessment(assessment.id))
            }
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        ) : null}
      </div>

      <label htmlFor="na-review-reason" style={labelStyle}>
        Reason (required to return for changes or reject)
      </label>
      <input
        id="na-review-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={inputStyle}
        placeholder="e.g. Cyber cover is missing — client stores card data"
      />
      <div style={reviewActionsStyle}>
        <button
          type="button"
          disabled={busy !== null || needsReason}
          style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
          onClick={() =>
            void run('return', () =>
              returnNeedsAssessment(assessment.id, reason.trim()),
            )
          }
        >
          {busy === 'return' ? 'Returning…' : 'Return for changes'}
        </button>
        <button
          type="button"
          disabled={busy !== null || needsReason}
          style={{ ...buttonStyle, marginTop: 0, width: 'auto' }}
          onClick={() =>
            void run('reject', () =>
              rejectNeedsAssessment(assessment.id, reason.trim()),
            )
          }
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
