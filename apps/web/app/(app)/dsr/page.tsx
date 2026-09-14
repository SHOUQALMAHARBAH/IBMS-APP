'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  applyDsrExtension,
  assignDsr,
  closeDsr,
  createDsr,
  DSR_TYPES,
  fulfilDsr,
  listDsrs,
  partiallyFulfilDsr,
  rejectDsr,
  startDsr,
  verifyDsrIdentity,
  type DataSubjectRequest,
} from '../../../lib/pdpl/dsr-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const LOG_ROLES = [
  'dsr.log',
];
const HANDLE_ROLES = [
  'dsr.handle',
];
const CLOSE_ROLES = [
  'dsr.close',
];

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


export default function DsrPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canLog = hasAnyPermission(user, LOG_ROLES);
  const canHandle = hasAnyPermission(user, HANDLE_ROLES);
  const canClose = hasAnyPermission(user, CLOSE_ROLES);

  const [rows, setRows] = useState<DataSubjectRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [type, setType] = useState<string>(DSR_TYPES[0]!);
  const [text, setText] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [confirmNoHold, setConfirmNoHold] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listDsrs());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the dsr.log permission."
          : err instanceof ApiError
            ? err.message
            : t('dsrLoadError'),
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
        err instanceof ApiError ? err.message : t('dsrActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createDsr({ customerId: customerId.trim(), type });
      setCustomerId('');
    });
  }

  const val = (id: string) => (text[id] ?? '').trim();
  const setVal = (id: string, v: string) => setText((t) => ({ ...t, [id]: v }));
  const ref = (id: string) => (reference[id] ?? '').trim();
  const setRef = (id: string, v: string) =>
    setReference((t) => ({ ...t, [id]: v }));

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('dsrHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dsrIntro')}
      </p>

      {canLog ? (
        <form
          onSubmit={submit}
          style={{ margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Customer ID
            <input
              aria-label={t('dsrCustomerIdLabel')}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Type
            <select
              aria-label={t('dsrTypeLabel')}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {DSR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('dsrSavingButton') : t('dsrLogButton')}
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
          <p style={{ opacity: 0.6 }}>{t('dsrNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '60rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('dsrColCustomer')}</th>
                  <th style={head}>{t('dsrTypeLabel')}</th>
                  <th style={head}>{t('dsrColStatus')}</th>
                  <th style={head}>{t('dsrColSlaDue')}</th>
                  <th style={head}>{t('dsrColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td style={cell}>{(d.customerId ?? d.insuredPersonId ?? '—').slice(0, 8)}…</td>
                    <td style={cell}>{d.type}</td>
                    <td style={cell}>{d.status}</td>
                    <td style={cell}>
                      {d.slaDueAt.slice(0, 10)}
                      {d.isOverdue ? ' (overdue)' : ''}
                    </td>
                    <td style={cell}>
                      {d.status === 'CLOSED' ? (
                        '—'
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '18rem' }}>
                          {canHandle ? (
                            <input
                              aria-label={`Text for ${d.id}`}
                              placeholder={t('dsrTextPlaceholder')}
                              value={text[d.id] ?? ''}
                              onChange={(e) => setVal(d.id, e.target.value)}
                            />
                          ) : null}
                          {canHandle && d.status === 'IN_PROGRESS' ? (
                            <input
                              aria-label={`Retention schedule reference for ${d.id}`}
                              placeholder={t('dsrRetentionRefPlaceholder')}
                              value={reference[d.id] ?? ''}
                              onChange={(e) => setRef(d.id, e.target.value)}
                            />
                          ) : null}
                          {canHandle && d.type === 'DELETION' && d.status === 'IN_PROGRESS' ? (
                            <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`No open retention hold for ${d.id}`}
                                checked={confirmNoHold[d.id] ?? false}
                                onChange={(e) =>
                                  setConfirmNoHold((c) => ({
                                    ...c,
                                    [d.id]: e.target.checked,
                                  }))
                                }
                              />
                              {t('dsrNoRetentionHold')}
                            </label>
                          ) : null}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {canHandle && d.status === 'RECEIVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => verifyDsrIdentity(d.id))}
                              >
                                {t('dsrVerifyIdentity')}
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IDENTITY_VERIFIED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => startDsr(d.id))}
                              >
                                {t('dsrStartButton')}
                              </button>
                            ) : null}
                            {canHandle &&
                            ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() => void run(() => assignDsr(d.id, val(d.id)))}
                              >
                                {t('dsrAssignButton')}
                              </button>
                            ) : null}
                            {canHandle && d.type === 'ACCESS' && d.status === 'IN_PROGRESS' && !d.accessExtensionAppliedAt ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() =>
                                  void run(() => applyDsrExtension(d.id, val(d.id)))
                                }
                              >
                                {t('dsrExtendButton')}
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy || (d.type === 'DELETION' && !confirmNoHold[d.id])}
                                onClick={() =>
                                  void run(() => fulfilDsr(d.id, confirmNoHold[d.id]))
                                }
                              >
                                {t('dsrFulfilButton')}
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy || !ref(d.id) || !val(d.id)}
                                onClick={() =>
                                  void run(() =>
                                    partiallyFulfilDsr(d.id, {
                                      retentionScheduleReference: ref(d.id),
                                      partialFulfilmentJustification: val(d.id),
                                    }),
                                  )
                                }
                              >
                                {t('dsrPartiallyFulfilButton')}
                              </button>
                            ) : null}
                            {canHandle &&
                            ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() => void run(() => rejectDsr(d.id, val(d.id)))}
                              >
                                {t('dsrRejectButton')}
                              </button>
                            ) : null}
                            {canClose &&
                            ['FULFILLED', 'PARTIALLY_FULFILLED', 'REJECTED'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeDsr(d.id))}
                              >
                                {t('dsrCloseButton')}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('dsrLoading')}</p>
      )}
    </main>
  );
}
