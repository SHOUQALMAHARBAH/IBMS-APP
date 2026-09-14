'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createRopaEntry,
  exportRopaRegister,
  listRopaEntries,
  type RopaEntry,
} from '../../../lib/pdpl/ropa-entry-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const ROLES = [
  'ropa.manage',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };


function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function RopaEntriesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasAnyPermission(user, ROLES);

  const [rows, setRows] = useState<RopaEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportedCount, setExportedCount] = useState<number | null>(null);

  const [processingActivity, setProcessingActivity] = useState('');
  const [categoriesOfData, setCategoriesOfData] = useState('');
  const [purpose, setPurpose] = useState('');
  const [recipients, setRecipients] = useState('');
  const [retentionPeriodMonths, setRetentionPeriodMonths] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listRopaEntries());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : t('ropaLoadError'),
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
        err instanceof ApiError ? err.message : t('ropaActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createRopaEntry({
        processingActivity: processingActivity.trim(),
        categoriesOfData: splitList(categoriesOfData),
        purpose: purpose.trim(),
        recipients: splitList(recipients),
        retentionPeriodMonths: retentionPeriodMonths.trim()
          ? Number(retentionPeriodMonths)
          : undefined,
      });
      setProcessingActivity('');
      setCategoriesOfData('');
      setPurpose('');
      setRecipients('');
      setRetentionPeriodMonths('');
    });
  }

  async function doExport() {
    setBusy(true);
    setActionError(null);
    try {
      const summary = await exportRopaRegister();
      setExportedCount(summary.entryCount);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('ropaExportError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('ropaHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('ropaIntro')}
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
      {exportedCount !== null ? (
        <p role="status" style={{ opacity: 0.75 }}>
          Exported {exportedCount} entr{exportedCount === 1 ? 'y' : 'ies'}.
        </p>
      ) : null}

      {canManage ? (
        <>
          <form
            onSubmit={(ev) => void submit(ev)}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Processing activity
              <input
                aria-label={t('ropaActivityLabel')}
                value={processingActivity}
                onChange={(e) => setProcessingActivity(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('ropaDataCategoriesLabel')}
              <input
                aria-label={t('ropaColDataCategories')}
                value={categoriesOfData}
                onChange={(e) => setCategoriesOfData(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Purpose
              <input
                aria-label={t('ropaPurposeLabel')}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('ropaRecipientsLabel')}
              <input
                aria-label={t('ropaColRecipients')}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('ropaRetentionMonthsLabel')}
              <input
                aria-label={t('ropaRetentionMonthsLabel')}
                type="number"
                min={1}
                value={retentionPeriodMonths}
                onChange={(e) => setRetentionPeriodMonths(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('ropaSavingButton') : t('ropaAddButton')}
            </button>
          </form>
          <button type="button" disabled={busy} onClick={() => void doExport()}>
            {t('ropaExportButton')}
          </button>
        </>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>{t('ropaNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={t('ropaHeading')}>
            <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('ropaColActivity')}</th>
                  <th style={head}>{t('ropaColDataCategories')}</th>
                  <th style={head}>{t('ropaPurposeLabel')}</th>
                  <th style={head}>{t('ropaColRecipients')}</th>
                  <th style={head}>{t('ropaColRetentionMonths')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.processingActivity}</td>
                    <td style={cell}>{r.categoriesOfData.join(', ')}</td>
                    <td style={cell}>{r.purpose}</td>
                    <td style={cell}>{r.recipients.join(', ')}</td>
                    <td style={cell}>{r.retentionPeriodMonths ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('ropaLoading')}</p>
      )}
    </main>
  );
}
