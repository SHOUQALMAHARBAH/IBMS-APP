'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  closeInternalAuditFinding,
  createInternalAuditFinding,
  listInternalAuditFindings,
  recordInternalAuditFindingRemediation,
  type InternalAuditFinding,
} from '../../../lib/compliance-risk/internal-audit-finding-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const RECORD_ROLE = [
  'internal-audit.record',
];
const CLOSE_ROLE = [
  'internal-audit.close',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };


export default function InternalAuditFindingsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canRecord = hasAnyPermission(user, RECORD_ROLE);
  const canClose = hasAnyPermission(user, CLOSE_ROLE);

  const [findings, setFindings] = useState<InternalAuditFinding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [auditPeriodLabel, setAuditPeriodLabel] = useState('');
  const [finding, setFinding] = useState('');
  const [remediationDrafts, setRemediationDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setFindings(await listInternalAuditFindings());
      setLoadError(null);
    } catch (err) {
      setFindings(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('iafNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('iafLoadError'),
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
      setActionError(err instanceof ApiError ? err.message : t('iafActionError'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createInternalAuditFinding({ auditPeriodLabel, finding });
      setAuditPeriodLabel('');
      setFinding('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('iafHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('iafIntro')}
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

      {canRecord ? (
        <form onSubmit={submit} style={formStyle}>
          <label style={labelStyle}>
            {t('iafAuditPeriodFieldLabel')}
            <input
              aria-label={t('iafAuditPeriodLabel')}
              value={auditPeriodLabel}
              onChange={(e) => setAuditPeriodLabel(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('iafFindingLabel')}
            <input
              aria-label={t('iafFindingLabel')}
              value={finding}
              onChange={(e) => setFinding(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('iafSavingButton') : t('iafRecordButton')}
          </button>
        </form>
      ) : null}

      {findings && findings.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)' }}>{t('iafNone')}</p>
      ) : null}

      {findings && findings.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '60rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('iafAuditPeriodLabel')}</th>
                <th style={head}>{t('iafColFinding')}</th>
                <th style={head}>{t('iafColRemediation')}</th>
                <th style={head}>{t('iafColStatus')}</th>
                <th style={head}>{t('iafColAction')}</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td style={cell}>{f.auditPeriodLabel}</td>
                  <td style={cell}>{f.finding}</td>
                  <td style={cell}>{f.remediationAction ?? '—'}</td>
                  <td style={cell}>{f.status}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '16rem' }}>
                      {canRecord && f.status === 'open' ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <input
                            aria-label={t('iafRemediationActionAria', { id: f.id })}
                            placeholder={t('iafRemediationActionLabel')}
                            value={remediationDrafts[f.id] ?? ''}
                            onChange={(e) =>
                              setRemediationDrafts((d) => ({ ...d, [f.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            disabled={busy || !(remediationDrafts[f.id] ?? '').trim()}
                            onClick={() =>
                              void run(() =>
                                recordInternalAuditFindingRemediation(
                                  f.id,
                                  (remediationDrafts[f.id] ?? '').trim(),
                                ),
                              )
                            }
                          >
                            {t('iafSaveRemediationButton')}
                          </button>
                        </div>
                      ) : null}
                      {canClose && f.status === 'open' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeInternalAuditFinding(f.id))}
                        >
                          {t('iafCloseButton')}
                        </button>
                      ) : null}
                      {f.status === 'closed' ? '—' : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('iafLoading')}</p>
      )}
    </main>
  );
}
