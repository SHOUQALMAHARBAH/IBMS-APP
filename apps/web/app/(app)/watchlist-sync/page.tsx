'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getWatchlistSyncStatus,
  runRecurringScreeningBatch,
  runWatchlistSync,
  type WatchlistSyncRun,
} from '../../../lib/compliance-risk/watchlist-sync-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';


const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function WatchlistSyncPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasPermission(user, 'sanctions-pep.screen');

  const [runs, setRuns] = useState<WatchlistSyncRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await getWatchlistSyncStatus());
      setLoadError(null);
    } catch (err) {
      setRuns(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('wsNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('wsLoadError'),
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

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('wsActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setMessage(null);
    await run(async () => {
      const outcomes = await runWatchlistSync();
      setMessage(
        outcomes
          .map(
            (o) =>
              `${o.source}: ${o.status}${o.recordCount !== undefined ? ` (${o.recordCount} records)` : ''}${o.errorMessage ? ` — ${o.errorMessage}` : ''}`,
          )
          .join(' · '),
      );
    });
  }

  async function batch() {
    setMessage(null);
    await run(async () => {
      const result = await runRecurringScreeningBatch();
      setMessage(
        `Re-screened ${result.screened} active customer(s) — ${result.hits} produced a HIT, ${result.failed} failed.`,
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('wsHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('wsIntro')}
      </p>

      {canManage ? (
        <div style={{ display: 'flex', gap: '0.6rem', margin: '1rem 0' }}>
          <button type="button" disabled={busy} onClick={() => void sync()}>
            {t('wsSyncButton')}
          </button>
          <button type="button" disabled={busy} onClick={() => void batch()}>
            {t('wsRunBatchButton')}
          </button>
        </div>
      ) : null}

      {message ? <p style={{ opacity: 0.75 }}>{message}</p> : null}
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

      {runs ? (
        runs.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>{t('wsNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('wsColSource')}</th>
                  <th style={head}>{t('wsColStatus')}</th>
                  <th style={head}>{t('wsColRecords')}</th>
                  <th style={head}>{t('wsColStarted')}</th>
                  <th style={head}>{t('wsColCompleted')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.source}</td>
                    <td style={cell}>{r.status}</td>
                    <td style={cell}>{r.recordCount ?? '—'}</td>
                    <td style={cell}>{r.startedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td style={cell}>
                      {r.completedAt ? r.completedAt.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('wsLoading')}</p>
      )}
    </main>
  );
}
