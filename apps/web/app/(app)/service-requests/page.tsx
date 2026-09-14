'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  cancelServiceRequest,
  createServiceRequest,
  fulfilServiceRequest,
  listServiceRequests,
  startServiceRequest,
  type ServiceRequest,
} from '../../../lib/customer-service/service-request-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';

const REQUEST_TYPES = ['certificate', 'copy', 'change', 'other'] as const;

/** Request type / status -> label key. Both are plain lowercase strings in the
 * schema rather than Prisma enums, so this mapping is the only thing keeping
 * `in_progress` off a user's screen. */
const TYPE_LABEL_KEY: Record<(typeof REQUEST_TYPES)[number], TranslationKey> = {
  certificate: 'srTypeCertificate',
  copy: 'srTypeCopy',
  change: 'srTypeChange',
  other: 'srTypeOther',
};
const STATUS_LABEL_KEY: Record<string, TranslationKey> = {
  open: 'srStatusOpen',
  in_progress: 'srStatusInProgress',
  fulfilled: 'srStatusFulfilled',
  cancelled: 'srStatusCancelled',
};

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

function slaLabel(r: ServiceRequest): string {
  if (!r.sla) return '—';
  if (r.sla.resolvedAt) return `resolved`;
  if (r.sla.breached) return `BREACHED (due ${r.sla.dueAt.slice(0, 10)})`;
  return `due ${r.sla.dueAt.slice(0, 10)}`;
}

export default function ServiceRequestsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage =
    !!user &&
    hasPermission(user, 'service-request.manage');

  const [rows, setRows] = useState<ServiceRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [requestType, setRequestType] = useState('certificate');
  const [detail, setDetail] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listServiceRequests());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('srNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('srLoadError'),
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
        err instanceof ApiError ? err.message : t('srActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createServiceRequest({
        customerId: customerId.trim(),
        requestType,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      });
      setCustomerId('');
      setDetail('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('srHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('srIntro')}
      </p>

      {canManage ? (
        <form onSubmit={submit} style={{ margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '30rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('srCustomerIdLabel')}
            <input
              aria-label={t('srCustomerIdLabel')}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('srTypeLabel')}
            <select
              aria-label={t('srTypeLabel')}
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
            >
              {REQUEST_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t(TYPE_LABEL_KEY[rt])}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('srDetailLabel')}
            <input
              aria-label={t('srColDetail')}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('srSavingButton') : t('srLogButton')}
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
          <p style={{ opacity: 0.6 }}>{t('srNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('srColCustomer')}</th>
                  <th style={head}>{t('srColType')}</th>
                  <th style={head}>{t('srColDetail')}</th>
                  <th style={head}>{t('srColStatus')}</th>
                  <th style={head}>{t('srColSla')}</th>
                  <th style={head}>{t('srColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId.slice(0, 8)}…</td>
                    <td style={cell}>
                      {TYPE_LABEL_KEY[r.requestType as keyof typeof TYPE_LABEL_KEY]
                        ? t(TYPE_LABEL_KEY[r.requestType as keyof typeof TYPE_LABEL_KEY])
                        : r.requestType}
                    </td>
                    <td style={cell}>{r.detail ?? '—'}</td>
                    <td style={cell}>
                      {STATUS_LABEL_KEY[r.status] ? t(STATUS_LABEL_KEY[r.status]) : r.status}
                    </td>
                    <td style={cell}>{slaLabel(r)}</td>
                    <td style={cell}>
                      {canManage && !r.isClosed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {r.status === 'open' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => startServiceRequest(r.id))}
                            >
                              {t('srStartButton')}
                            </button>
                          ) : null}
                          <input
                            aria-label={t('srOutcomeNoteLabel')}
                            placeholder={t('srOutcomeNoteLabel')}
                            value={notes[r.id] ?? ''}
                            onChange={(e) =>
                              setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                            }
                          />
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  fulfilServiceRequest(r.id, (notes[r.id] ?? '').trim()),
                                )
                              }
                            >
                              {t('srFulfilButton')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  cancelServiceRequest(r.id, (notes[r.id] ?? '').trim()),
                                )
                              }
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        (r.outcomeNote ?? '—')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('srLoading')}</p>
      )}
    </main>
  );
}
