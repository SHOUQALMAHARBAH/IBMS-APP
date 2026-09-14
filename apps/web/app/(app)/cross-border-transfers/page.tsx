'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CROSS_BORDER_LEGAL_BASES,
  createCrossBorderTransfer,
  listCrossBorderTransfers,
  type CrossBorderTransferRecord,
} from '../../../lib/pdpl/cross-border-transfer-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const ROLES = [
  'cross-border-transfer.approve',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };


export default function CrossBorderTransfersPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasAnyPermission(user, ROLES);

  const [records, setRecords] = useState<CrossBorderTransferRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [description, setDescription] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [legalBasis, setLegalBasis] = useState<string>(CROSS_BORDER_LEGAL_BASES[0]);
  const [evidenceRef, setEvidenceRef] = useState('');

  const load = useCallback(async () => {
    try {
      setRecords(await listCrossBorderTransfers());
      setLoadError(null);
    } catch (err) {
      setRecords(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : t('cbtLoadError'),
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
        err instanceof ApiError ? err.message : t('cbtActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createCrossBorderTransfer({
        description: description.trim(),
        destinationCountry: destinationCountry.trim(),
        legalBasis,
        legalBasisEvidenceRef: evidenceRef.trim() || undefined,
      });
      setDescription('');
      setDestinationCountry('');
      setEvidenceRef('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('cbtHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('cbtIntro')}
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

      {canManage ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Description
            <input
              aria-label={t('cbtDescriptionLabel')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Destination country
            <input
              aria-label={t('cbtDestinationLabel')}
              value={destinationCountry}
              onChange={(e) => setDestinationCountry(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Legal basis
            <select
              aria-label={t('cbtLegalBasisLabel')}
              value={legalBasis}
              onChange={(e) => setLegalBasis(e.target.value)}
            >
              {CROSS_BORDER_LEGAL_BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('cbtEvidenceRefLabel')}
            <input
              aria-label={t('cbtEvidenceRefLabel')}
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('cbtSavingButton') : t('cbtLogButton')}
          </button>
        </form>
      ) : null}

      {records ? (
        records.length === 0 ? (
          <p style={{ opacity: 0.6 }}>{t('cbtNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('cbtColDestination')}</th>
                  <th style={head}>{t('cbtLegalBasisLabel')}</th>
                  <th style={head}>{t('cbtDescriptionLabel')}</th>
                  <th style={head}>{t('cbtColApprovedBy')}</th>
                  <th style={head}>{t('cbtColTransferredAt')}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.destinationCountry}</td>
                    <td style={cell}>{r.legalBasis}</td>
                    <td style={cell}>{r.description}</td>
                    <td style={cell}>{r.approvedByUserId ? r.approvedByUserId.slice(0, 8) + '…' : '—'}</td>
                    <td style={cell}>{r.transferredAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('cbtLoading')}</p>
      )}
    </main>
  );
}
