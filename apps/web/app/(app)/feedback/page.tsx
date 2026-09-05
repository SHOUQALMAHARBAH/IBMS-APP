'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  FEEDBACK_CONTEXTS,
  createFeedback,
  listFeedback,
  type Feedback,
} from '../../../lib/customer-service/feedback-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const SALES_ROLE = 'SALES_RELATIONSHIP_OFFICER';

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function FeedbackPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canLog = !!user && user.roles.includes(SALES_ROLE);

  const [rows, setRows] = useState<Feedback[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [context, setContext] = useState<string>(FEEDBACK_CONTEXTS[0]);
  const [score, setScore] = useState('');
  const [comments, setComments] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listFeedback());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the feedback.log permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load feedback — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createFeedback({
        customerId: customerId.trim(),
        context,
        ...(score.trim() ? { score: Number(score) } : {}),
        ...(comments.trim() ? { comments: comments.trim() } : {}),
      });
      setCustomerId('');
      setScore('');
      setComments('');
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'The submit failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Customer feedback</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Satisfaction survey responses logged post-issuance, post-claim, or
        post-renewal. A factual log — no workflow, no SLA.
      </p>

      {canLog ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: '0.4rem',
            maxWidth: '30rem',
          }}
        >
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Customer ID
            <input
              aria-label="Customer ID"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Context
            <select
              aria-label="Context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            >
              {FEEDBACK_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Score (1-5, optional)
            <input
              aria-label="Score"
              type="number"
              min={1}
              max={5}
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            Comments (optional)
            <textarea
              aria-label="Comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? 'Saving…' : 'Log feedback'}
          </button>
        </form>
      ) : null}

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No feedback logged.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
              <thead>
                <tr>
                  <th style={head}>Customer</th>
                  <th style={head}>Context</th>
                  <th style={head}>Score</th>
                  <th style={head}>Comments</th>
                  <th style={head}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId.slice(0, 8)}…</td>
                    <td style={cell}>{r.context}</td>
                    <td style={cell}>{r.score ?? '—'}</td>
                    <td style={cell}>{r.comments ?? '—'}</td>
                    <td style={cell}>{r.submittedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </main>
  );
}
