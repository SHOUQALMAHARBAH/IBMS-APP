'use client';

import { useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
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
import { actionErrorText } from '../../../lib/i18n/action-error';
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
import type { TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

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
          ? permissionRefusal(t, 'srRefusalAct', 'service-request.manage')
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
        actionErrorText(err, t, 'srActionError'),
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('srHeading')}
        description={t('srIntro')}
      />

      {canManage ? (
        <form onSubmit={submit} style={{ margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '30rem' }}>
          <EntitySearch
            kind="customer"
            value={customerId}
            onChange={setCustomerId}
            label={t('srCustomerIdLabel')}
            required
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('srDetailLabel')}
            <input
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
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('srNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('srColCustomer')}</Th>
                  <Th>{t('srColType')}</Th>
                  <Th>{t('srColDetail')}</Th>
                  <Th>{t('srColStatus')}</Th>
                  <Th>{t('srColSla')}</Th>
                  <Th>{t('srColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    {/* RULE 2 — the name, never the id. */}
                    <Td>
                      <bdi>{r.customerName}</bdi>
                    </Td>
                    <Td>
                      {TYPE_LABEL_KEY[r.requestType as keyof typeof TYPE_LABEL_KEY]
                        ? t(TYPE_LABEL_KEY[r.requestType as keyof typeof TYPE_LABEL_KEY])
                        : r.requestType}
                    </Td>
                    <Td>{r.detail ?? '—'}</Td>
                    <Td>
                      {STATUS_LABEL_KEY[r.status] ? t(STATUS_LABEL_KEY[r.status]) : r.status}
                    </Td>
                    <Td>{slaLabel(r)}</Td>
                    <Td>
                      {canManage && !r.isClosed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
                              {t('commonCancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        (r.outcomeNote ?? '—')
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('srLoading')} />
      )}
    </main>
  );
}
