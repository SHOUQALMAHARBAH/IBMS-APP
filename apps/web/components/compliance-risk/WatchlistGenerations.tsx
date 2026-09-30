'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  datasetCanBeRestored,
  listWatchlistDatasets,
  rollbackReasonIsValid,
  rollbackWatchlistDataset,
  type WatchlistDatasetVersion,
} from '../../lib/compliance-risk/watchlist-sync-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * THE GENERATIONS OF EACH SANCTIONS LIST, AND RESTORING AN EARLIER ONE.
 *
 * `GET /watchlist-sync/datasets` and `POST /watchlist-sync/datasets/:id/rollback`
 * had no web caller, and the rollback wrote no audit row (IMPROVEMENTS § 1.44,
 * § 1.63) — it did have api e2e coverage, which is worth being accurate about. The
 * API's own comment calls the rollback "the most consequential manual override in
 * this module": it decides that the newest available sanctions list is NOT the one
 * screening runs against. An office that received a truncated or corrupted list
 * had no way back to the last good generation from inside the application.
 *
 * The reason field is not paperwork. Restoring an older list narrows what
 * screening can find, so the stated basis is the control — and it is now written
 * to the audit trail rather than only to the application log, which is the other
 * half of § 1.63.
 *
 * WHY THE CONTROL IS CONDITIONAL RATHER THAN ALWAYS OFFERED
 * -------------------------------------------------------
 * The server refuses three distinct ways, and one of them is a trap: a generation
 * past the retention window is still LISTED — so it looks available — while its
 * rows are gone, and restoring it would leave screening running against nothing.
 * Screening that finds nobody looks exactly like screening that cleared everybody.
 * So the screen offers the control only where it can plausibly succeed, and the
 * server's own refusal is rendered when its live count disagrees.
 */

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};
const muted: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--ink-secondary)',
};

export function WatchlistGenerations() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [rows, setRows] = useState<WatchlistDatasetVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listWatchlistDatasets());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError ? err.message : t('wsGenerationsLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  const restore = useCallback(
    async (id: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await rollbackWatchlistDataset(id, reason);
        setRestoringId(null);
        setReason('');
        await load();
      } catch (err) {
        // The server's own sentence: it distinguishes "not superseded" from
        // "no records left", and those are different operator problems.
        setActionError(
          err instanceof ApiError ? err.message : t('wsRestoreError'),
        );
      } finally {
        setBusy(false);
      }
    },
    [reason, load, t],
  );

  return (
    <section style={{ margin: '2rem 0' }} data-testid="watchlist-generations">
      <h2>{t('wsGenerationsHeading')}</h2>
      <p style={{ opacity: 0.75, maxWidth: '50rem' }}>
        {t('wsGenerationsIntro')}
      </p>

      {loadError && (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" style={errorStyle} data-testid="watchlist-restore-error">
          {actionError}
        </p>
      )}

      {rows == null ? (
        loadError ? null : (
          <p>{t('wsGenerationsLoading')}</p>
        )
      ) : rows.length === 0 ? (
        <p style={muted}>{t('wsGenerationsNone')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('wsColSource')}</th>
                <th style={head}>{t('wsColVersion')}</th>
                <th style={head}>{t('wsColGenerationStatus')}</th>
                <th style={head}>{t('wsColRecords')}</th>
                <th style={head}>{t('wsColDownloaded')}</th>
                <th style={head}>{t('wsRestore')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} data-testid={`generation-${d.id}`}>
                  <td style={cell}>{t(ENUM_LABEL.WatchlistSource[d.source])}</td>
                  <td style={cell}>{d.version}</td>
                  <td style={cell}>
                    <span data-testid={`generation-status-${d.id}`}>
                      {d.status}
                    </span>
                    {d.rollbackReason && (
                      <div style={muted}>
                        {t('wsRolledBackFrom')} {d.rollbackReason}
                      </div>
                    )}
                    {d.rejectionReason && (
                      <div style={muted}>{d.rejectionReason}</div>
                    )}
                  </td>
                  <td style={cell}>{d.recordCount ?? '—'}</td>
                  <td style={cell}>{d.downloadedAt.slice(0, 10)}</td>
                  <td style={cell}>
                    {!datasetCanBeRestored(d) ? (
                      // Said rather than left as a missing button: "why can I not
                      // restore this one" is the question a listed-but-reclaimed
                      // generation provokes.
                      <span style={muted} data-testid={`generation-locked-${d.id}`}>
                        {d.status === 'PUBLISHED' ? '—' : t('wsRestoreUnavailable')}
                      </span>
                    ) : restoringId === d.id ? (
                      <div style={{ display: 'grid', gap: '0.35rem', minWidth: '20rem' }}>
                        <label
                          htmlFor={`restore-reason-${d.id}`}
                          style={{ fontSize: '0.8rem' }}
                        >
                          {t('wsRestoreReason')}
                        </label>
                        <textarea
                          id={`restore-reason-${d.id}`}
                          data-testid={`restore-reason-${d.id}`}
                          rows={3}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <p style={{ ...muted, margin: 0 }}>
                          {t('wsRestoreReasonHint')}
                        </p>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            type="button"
                            data-testid={`restore-confirm-${d.id}`}
                            disabled={busy || !rollbackReasonIsValid(reason)}
                            onClick={() => void restore(d.id)}
                          >
                            {t('wsRestoreConfirm')}
                          </button>
                          <button
                            type="button"
                            data-testid={`restore-cancel-${d.id}`}
                            onClick={() => {
                              setRestoringId(null);
                              setReason('');
                              setActionError(null);
                            }}
                          >
                            {t('wsCancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`restore-${d.id}`}
                        disabled={busy}
                        onClick={() => {
                          setRestoringId(d.id);
                          setReason('');
                          setActionError(null);
                        }}
                      >
                        {t('wsRestore')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
