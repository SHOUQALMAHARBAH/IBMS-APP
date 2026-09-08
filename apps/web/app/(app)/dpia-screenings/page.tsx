'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createDpiaScreening,
  escalateDpiaToFullDpia,
  listDpiaScreenings,
  recordDpiaReview,
  recordDpiaSpotCheck,
  type DpiaScreening,
} from '../../../lib/pdpl/dpia-screening-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const ROLES = ['DATA_PROTECTION_OFFICER'];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

const INITIAL_ANSWERS = {
  qSensitiveData: false,
  qLargeScaleProcessing: false,
  qCrossBorderTransfer: false,
  qNewTechnologyMonitoring: false,
  qNewDigitalChannel: false,
};

const QUESTIONS: { key: keyof typeof INITIAL_ANSWERS; label: string }[] = [
  { key: 'qSensitiveData', label: 'Involves sensitive data?' },
  { key: 'qLargeScaleProcessing', label: 'Large-scale processing?' },
  { key: 'qCrossBorderTransfer', label: 'Cross-border transfer?' },
  { key: 'qNewTechnologyMonitoring', label: 'New technology / monitoring?' },
  { key: 'qNewDigitalChannel', label: 'New digital channel?' },
];

export default function DpiaScreeningsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = hasAny(user?.roles, ROLES);

  const [rows, setRows] = useState<DpiaScreening[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [subjectDescription, setSubjectDescription] = useState('');
  const [answers, setAnswers] = useState(INITIAL_ANSWERS);

  const load = useCallback(async () => {
    try {
      setRows(await listDpiaScreenings());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load DPIA screenings — try again.',
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

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'That action failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createDpiaScreening({ subjectDescription: subjectDescription.trim(), ...answers });
      setSubjectDescription('');
      setAnswers(INITIAL_ANSWERS);
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>DPIA Screening</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The 5-question screening form. Any single &quot;Yes&quot; requires
        DPO review within 5 business days; an all-&quot;No&quot; result
        auto-approves subject to a spot-check; a materially high-risk case
        under review can be escalated to a Full DPIA.
      </p>

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

      {canManage ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Subject
            <input
              aria-label="Subject description"
              value={subjectDescription}
              onChange={(e) => setSubjectDescription(e.target.value)}
              required
            />
          </label>
          {QUESTIONS.map((q) => (
            <label key={q.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input
                type="checkbox"
                checked={answers[q.key]}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.checked }))}
              />
              {q.label}
            </label>
          ))}
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Submit screening'}
          </button>
        </form>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No DPIA screenings yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
              <thead>
                <tr>
                  <th style={head}>Subject</th>
                  <th style={head}>Outcome</th>
                  <th style={head}>Review due</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.subjectDescription}</td>
                    <td style={cell}>{r.outcome}</td>
                    <td style={cell}>{r.dpoReviewDueAt ? r.dpoReviewDueAt.slice(0, 10) : '—'}</td>
                    <td style={cell}>
                      {!canManage ? (
                        '—'
                      ) : r.outcome === 'AUTO_APPROVED' && !r.dpoSpotCheckedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => recordDpiaSpotCheck(r.id))}
                        >
                          Spot-check
                        </button>
                      ) : r.outcome === 'DPO_REVIEW_REQUIRED' && !r.dpoReviewedAt ? (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => recordDpiaReview(r.id))}
                          >
                            Record review
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => escalateDpiaToFullDpia(r.id))}
                          >
                            Escalate to Full DPIA
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
