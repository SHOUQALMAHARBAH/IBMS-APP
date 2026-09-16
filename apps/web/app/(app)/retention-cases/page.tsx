'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  RETENTION_CASE_REASONS,
  closeRetentionCase,
  createRetentionCase,
  listRetentionCases,
  runRetentionSweep,
  type RetentionCase,
} from '../../../lib/customer-service/retention-case-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';

const REASON_LABEL_KEY: Record<string, TranslationKey> = {
  renewal_inactivity: 'retReasonRenewalInactivity',
  lapse_risk: 'retReasonLapseRisk',
};
const STATUS_LABEL_KEY: Record<string, TranslationKey> = {
  open: 'retStatusOpen',
  closed: 'retStatusClosed',
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

export default function RetentionCasesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasPermission(user, 'retention-case.manage');

  const [rows, setRows] = useState<RetentionCase[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState<string>(RETENTION_CASE_REASONS[0]);

  const load = useCallback(async () => {
    try {
      setRows(await listRetentionCases());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('retNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('retLoadError'),
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
        err instanceof ApiError ? err.message : t('retActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createRetentionCase({ customerId: customerId.trim(), reason });
      setCustomerId('');
    });
  }

  async function sweep() {
    setSweepMessage(null);
    await run(async () => {
      const result = await runRetentionSweep();
      setSweepMessage(
        `Scanned ${result.scanned} renewal case(s) — opened ${result.openedRenewalInactivity} for inactivity, ${result.openedLapseRisk} for lapse risk, ${result.failed} failed.`,
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('retHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('retIntro')}
      </p>

      {canManage ? (
        <>
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
              {t('retCustomerIdLabel')}
              <input
                aria-label={t('retCustomerIdLabel')}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              />
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              {t('retReasonLabel')}
              <select
                aria-label={t('retReasonLabel')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {RETENTION_CASE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(ENUM_LABEL.RetentionCaseReason[r])}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
              {busy ? t('retSavingButton') : t('retOpenButton')}
            </button>
          </form>
          <button type="button" disabled={busy} onClick={() => void sweep()}>
            {t('retSweepButton')}
          </button>
          {sweepMessage ? <p style={{ opacity: 0.75 }}>{sweepMessage}</p> : null}
        </>
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
          <p style={{ color: 'var(--ink-secondary)' }}>{t('retNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('retColCustomer')}</th>
                  <th style={head}>{t('retColReason')}</th>
                  <th style={head}>{t('retColStatus')}</th>
                  <th style={head}>{t('retColOpened')}</th>
                  <th style={head}>{t('retColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId.slice(0, 8)}…</td>
                    <td style={cell}>
                      {REASON_LABEL_KEY[r.reason] ? t(REASON_LABEL_KEY[r.reason]) : r.reason}
                    </td>
                    <td style={cell}>
                      {STATUS_LABEL_KEY[r.status] ? t(STATUS_LABEL_KEY[r.status]) : r.status}
                    </td>
                    <td style={cell}>{r.createdAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {canManage && !r.isClosed ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeRetentionCase(r.id))}
                        >
                          {t('retCloseButton')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('retLoading')}</p>
      )}
    </main>
  );
}
