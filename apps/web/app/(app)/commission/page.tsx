'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createCommissionAgreement,
  listCommissionAgreements,
  listCommissionInsurers,
  type CommissionAgreement,
  type Insurer,
} from '../../../lib/commission/commission-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';


function pct(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : v;
}

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

export default function CommissionRatesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage =
    !!user &&
    hasPermission(user, 'commission-rate.manage');

  const [rows, setRows] = useState<CommissionAgreement[] | null>(null);
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [insurerId, setInsurerId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [vatRatePercent, setVatRatePercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ags, ins] = await Promise.all([
        listCommissionAgreements(),
        listCommissionInsurers().catch(() => [] as Insurer[]),
      ]);
      setRows(ags);
      setInsurers(ins);
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the commission-rate.manage permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : t('crateLoadError'),
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

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await createCommissionAgreement({
        insurerId: insurerId.trim(),
        insuranceLine: insuranceLine.trim(),
        ratePercent: ratePercent.trim(),
        ...(vatRatePercent.trim() ? { vatRatePercent: vatRatePercent.trim() } : {}),
        ...(effectiveFrom ? { effectiveFrom } : {}),
      });
      setInsuranceLine('');
      setRatePercent('');
      setVatRatePercent('');
      setEffectiveFrom('');
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('crateOpenError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('crateHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        {t('crateIntro')}
      </p>

      {canManage ? (
        <form
          onSubmit={submit}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'end',
            margin: '1rem 0',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Insurer
            <select
              aria-label={t('crateInsurerLabel')}
              value={insurerId}
              onChange={(e) => setInsurerId(e.target.value)}
              required
            >
              <option value="">{t('crateSelectInsurer')}</option>
              {insurers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Insurance line
            <input
              aria-label={t('crateLineLabel')}
              value={insuranceLine}
              onChange={(e) => setInsuranceLine(e.target.value)}
              placeholder={t('crateLinePlaceholder')}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('crateRateLabel')}
            <input
              aria-label={t('crateRateAria')}
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="15"
              inputMode="decimal"
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('crateVatLabel')}
            <input
              aria-label={t('crateVatAria')}
              value={vatRatePercent}
              onChange={(e) => setVatRatePercent(e.target.value)}
              placeholder="16"
              inputMode="decimal"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Effective from
            <input
              type="date"
              aria-label={t('crateEffectiveFromLabel')}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('crateSavingButton') : t('crateOpenWindowButton')}
          </button>
        </form>
      ) : null}
      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>{t('crateNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '42rem' }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>{t('crateInsurerLabel')}</th>
                  <th style={headCellStyle}>{t('crateLineLabel')}</th>
                  <th style={{ ...headCellStyle, textAlign: 'end' }}>{t('crateColRate')}</th>
                  <th style={{ ...headCellStyle, textAlign: 'end' }}>{t('crateColVat')}</th>
                  <th style={headCellStyle}>{t('crateEffectiveFromLabel')}</th>
                  <th style={headCellStyle}>{t('crateColEffectiveTo')}</th>
                  <th style={headCellStyle}>{t('crateColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cellStyle}>
                      <bdi>{r.insurerName}</bdi>
                    </td>
                    <td style={cellStyle}>
                      <bdi>{r.insuranceLine}</bdi>
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'end' }}>
                      {pct(r.ratePercent)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'end' }}>
                      {pct(r.vatRatePercent)}
                    </td>
                    <td style={cellStyle}>{r.effectiveFrom.slice(0, 10)}</td>
                    <td style={cellStyle}>
                      {r.effectiveTo ? r.effectiveTo.slice(0, 10) : '—'}
                    </td>
                    <td style={cellStyle}>
                      {r.isOpen ? <strong>{t('crateOpen')}</strong> : 'Closed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('crateLoading')}</p>
      )}
    </main>
  );
}
