'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getWatchlistSyncStatus,
  runRecurringScreeningBatch,
  runWatchlistSync,
  type WatchlistSyncRun,
} from '../../../lib/compliance-risk/watchlist-sync-api';
import { WatchlistGenerations } from '../../../components/compliance-risk/WatchlistGenerations';
import { ActionStatus } from '../../../components/ui';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';


export default function WatchlistSyncPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, tPlural } = useLanguage();
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
          ? permissionRefusal(t, 'wsRefusalAct', 'sanctions-pep.screen')
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
      // A template literal hides raw enum values from any scan that looks at
      // JSX, which is how `OFAC_SDN: succeeded (19329 records)` survived the
      // sweep of the tables on this same screen.
      setMessage(
        outcomes
          .map((o) => {
            const head = `${t(ENUM_LABEL.WatchlistSource[o.source])}: ${t(
              ENUM_LABEL.WatchlistSyncRunStatus[o.status],
            )}`;
            const count =
              o.recordCount !== undefined
                ? ` (${tPlural('wlsRecordsSynced', o.recordCount)})`
                : '';
            // The provider's own error text, never translated - it is
            // evidence, and rewording it would make it disagree with the log.
            const error = o.errorMessage ? ` — ${o.errorMessage}` : '';
            return `${head}${count}${error}`;
          })
          .join(' · '),
      );
    });
  }

  async function batch() {
    setMessage(null);
    await run(async () => {
      const result = await runRecurringScreeningBatch();
      setMessage(
        t('wsRescreenSummary', {
          screened: result.screened,
          hits: result.hits,
          failed: result.failed,
        }),
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('wsHeading')}
        description={t('wsIntro')}
      />

      {canManage ? (
        <div style={{ display: 'flex', gap: '0.6rem', margin: '1rem 0' }}>
          <button type="button" disabled={busy} onClick={() => void sync()}>
            {busy ? t('commonWorking') : t('wsSyncButton')}
          </button>
          <button type="button" disabled={busy} onClick={() => void batch()}>
            {busy ? t('commonWorking') : t('wsRunBatchButton')}
          </button>
        </div>
      ) : null}

      {/* The act RAN before this; nothing said so. See ActionStatus's header:
          the sync fetches two public lists with a 120s timeout and two retries
          each, so `disabled` alone left the screen silent for minutes. */}
      <ActionStatus
        pending={busy ? t('commonWorking') : undefined}
        outcome={message ?? undefined}
        error={actionError ?? undefined}
        testId="ws-action"
      />
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {runs ? (
        runs.length === 0 ? (
          <EmptyState title={t('wsNone')} />
        ) : (
          <div style={{ overflowX: 'auto' }} data-testid="watchlist-runs">
            <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('wsColSource')}</Th>
                  <Th>{t('wsColStatus')}</Th>
                  <Th>{t('wsColRecords')}</Th>
                  <Th>{t('wsColStarted')}</Th>
                  <Th>{t('wsColCompleted')}</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <Tr key={r.id}>
                    <Td>{t(ENUM_LABEL.WatchlistSource[r.source])}</Td>
                    <Td>{t(ENUM_LABEL.WatchlistSyncRunStatus[r.status])}</Td>
                    <Td>{r.recordCount ?? '—'}</Td>
                    <Td>{r.startedAt.slice(0, 16).replace('T', ' ')}</Td>
                    <Td>
                      {r.completedAt ? r.completedAt.slice(0, 16).replace('T', ' ') : '—'}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          </div>
        )
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <SkeletonList rows={4} label={t('wsLoading')} />
      )}

      {/* The generations behind the runs above, and the way back to an earlier
        * one. Same permission as the rest of this screen (`sanctions-pep.screen`
        * gates all four routes), so no separate gate is needed — which is why
        * this is a section here rather than a screen of its own. */}
      <WatchlistGenerations />
    </main>
  );
}
