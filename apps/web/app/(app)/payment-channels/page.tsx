'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createPaymentChannel,
  disablePaymentChannel,
  listPaymentChannels,
  type PaymentChannel,
} from '../../../lib/finance/payment-channel-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const CHANNEL_TYPES = ['bank_transfer', 'cheque', 'card', 'cash'] as const;

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

export default function PaymentChannelsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  // Four-action Phase 4 — three codes, because adding a destination for client money and disabling one
  // are not one capability. A Finance officer can be given the LIST (which recording a receipt needs)
  // without either.
  const canCreate = hasPermission(user, 'payment-channel.create');
  const canDeactivate = hasPermission(user, 'payment-channel.deactivate');

  const [rows, setRows] = useState<PaymentChannel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ownerType, setOwnerType] = useState('customer');
  const [ownerId, setOwnerId] = useState('');
  const [channelType, setChannelType] = useState('bank_transfer');
  const [label, setLabel] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listPaymentChannels());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('pcNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('pcLoadError'),
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
      await createPaymentChannel({
        ownerType,
        ...(ownerType === 'customer'
          ? { customerId: ownerId.trim() }
          : { insurerId: ownerId.trim() }),
        channelType,
        label: label.trim(),
        ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
        ...(accountLast4.trim() ? { accountLast4: accountLast4.trim() } : {}),
      });
      setOwnerId('');
      setLabel('');
      setBankName('');
      setAccountLast4('');
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('pcAddError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable(id: string) {
    setBusy(true);
    setFormError(null);
    try {
      await disablePaymentChannel(id);
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t('pcDisableError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('pcHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('pcIntro')}
      </p>

      {canCreate ? (
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
          <label style={labelStyle}>
            {t('pcOwnerFieldLabel')}
            <select
              aria-label={t('pcOwnerTypeAria')}
              value={ownerType}
              onChange={(e) => setOwnerType(e.target.value)}
            >
              <option value="customer">{t('pcCustomer')}</option>
              <option value="insurer">{t('pcInsurer')}</option>
            </select>
          </label>
          {/* The insurer branch keeps the id field: insurers are a different
              list with a different search, and a customer picker there would
              be worse than the box it replaced. */}
          {ownerType === 'customer' ? (
            <EntitySearch
            kind="customer"
              value={ownerId}
              onChange={setOwnerId}
              label={t('pcCustomerIdLabel')}
              required
            />
          ) : (
            <label style={labelStyle}>
              {t('pcInsurerIdLabel')}
              <input
                aria-label={t('pcOwnerIdAria')}
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                required
              />
            </label>
          )}
          <label style={labelStyle}>
            {t('pcChannelTypeLabel')}
            <select
              aria-label={t('pcChannelTypeLabel')}
              value={channelType}
              onChange={(e) => setChannelType(e.target.value)}
            >
              {CHANNEL_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {t(ENUM_LABEL.PaymentChannelType[opt])}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            {t('pcLabelLabel')}
            <input
              aria-label={t('pcLabelLabel')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('pcBankPlaceholder')}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('pcBankNameLabel')}
            <input
              aria-label={t('pcBankNameLabel')}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            {t('pcAccountLabel')}
            <input
              aria-label={t('pcAccountAria')}
              value={accountLast4}
              onChange={(e) => setAccountLast4(e.target.value)}
              inputMode="numeric"
              maxLength={4}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('pcSavingButton') : t('pcAddButton')}
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
          <p style={{ color: 'var(--ink-secondary)' }}>{t('pcNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>{t('pcOwnerLabel')}</th>
                  <th style={headCellStyle}>{t('pcOwnerIdLabel')}</th>
                  <th style={headCellStyle}>{t('pcColType')}</th>
                  <th style={headCellStyle}>{t('pcLabelLabel')}</th>
                  <th style={headCellStyle}>{t('pcColBank')}</th>
                  <th style={headCellStyle}>{t('pcColAccount')}</th>
                  <th style={headCellStyle}>{t('pcColStatus')}</th>
                  <th style={headCellStyle} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cellStyle}>{r.ownerType}</td>
                    <td style={cellStyle}>{r.customerId ?? r.insurerId}</td>
                    <td style={cellStyle}>{r.channelType}</td>
                    <td style={cellStyle}>{r.label}</td>
                    <td style={cellStyle}>{r.bankName ?? '—'}</td>
                    <td style={cellStyle}>
                      {r.accountLast4 ? `••••${r.accountLast4}` : '—'}
                    </td>
                    <td style={cellStyle}>
                      {r.isActive ? <strong>{t('pcActive')}</strong> : t('pcDisabled')}
                    </td>
                    <td style={cellStyle}>
                      {canDeactivate && r.isActive ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void disable(r.id)}
                        >
                          {t('pcDisableButton')}
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
        <p>{t('pcLoading')}</p>
      )}
    </main>
  );
}
