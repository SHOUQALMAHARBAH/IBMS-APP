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
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';

/** Feedback context values are plain lowercase strings, not a Prisma enum. */
const CONTEXT_LABEL_KEY: Record<string, TranslationKey> = {
  post_issuance: 'fbContextPostIssuance',
  post_claim: 'fbContextPostClaim',
  post_renewal: 'fbContextPostRenewal',
};


const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};

export default function FeedbackPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canLog = hasPermission(user, 'feedback.log');

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
          ? t('fbNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('fbLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

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
        err instanceof ApiError ? err.message : t('fbSubmitError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('fbHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('fbIntro')}
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
            {t('fbCustomerIdLabel')}
            <input
              aria-label={t('fbCustomerIdLabel')}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
          >
            {t('fbContextLabel')}
            <select
              aria-label={t('fbContextLabel')}
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
            {t('fbScoreLabel')}
            <input
              aria-label={t('fbColScore')}
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
            {t('fbCommentsLabel')}
            <textarea
              aria-label={t('fbColComments')}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('fbSavingButton') : t('fbLogButton')}
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
          <p style={{ color: 'var(--ink-secondary)' }}>{t('fbNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('fbColCustomer')}</th>
                  <th style={head}>{t('fbColContext')}</th>
                  <th style={head}>{t('fbColScore')}</th>
                  <th style={head}>{t('fbColComments')}</th>
                  <th style={head}>{t('fbColSubmitted')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId.slice(0, 8)}…</td>
                    <td style={cell}>
                      {CONTEXT_LABEL_KEY[r.context] ? t(CONTEXT_LABEL_KEY[r.context]) : r.context}
                    </td>
                    <td style={cell}>{r.score ?? '—'}</td>
                    <td style={cell}>{r.comments ?? '—'}</td>
                    <td style={cell}>{r.submittedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        // Loading only when nothing has failed — otherwise the error and a
        // "Loading…" line render together, which is the state-conflation
        // directive §2 is about. Same guard the complaints page uses.
        <p>{t('fbLoading')}</p>
      )}
    </main>
  );
}
