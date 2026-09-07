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

const MONITOR_ROLE = 'COMPLIANCE_OFFICER';

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

export default function WatchlistSyncPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = !!user && user.roles.includes(MONITOR_ROLE);

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
          ? "You don't hold the sanctions-pep.screen permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the sync status — try again.',
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
      <h1>Sanctions &amp; PEP watchlist sync</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Two free public sanctions lists (OFAC SDN, UN Consolidated) are
        synced locally every 12 hours — the lists&apos; own real-world
        refresh cadence — and every ACTIVE customer is re-screened against
        them every 4 hours. Both can also be run on demand here.
      </p>

      {canManage ? (
        <div style={{ display: 'flex', gap: '0.6rem', margin: '1rem 0' }}>
          <button type="button" disabled={busy} onClick={() => void sync()}>
            Sync watchlists now
          </button>
          <button type="button" disabled={busy} onClick={() => void batch()}>
            Run recurring screening batch now
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
          <p style={{ opacity: 0.6 }}>No sync has run yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
              <thead>
                <tr>
                  <th style={head}>Source</th>
                  <th style={head}>Status</th>
                  <th style={head}>Records</th>
                  <th style={head}>Started</th>
                  <th style={head}>Completed</th>
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
      ) : null}
    </main>
  );
}
