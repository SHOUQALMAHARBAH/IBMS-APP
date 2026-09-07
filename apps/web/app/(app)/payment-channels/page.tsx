'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
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

const FINANCE_ROLE = 'FINANCE_COLLECTIONS_OFFICER';
const CHANNEL_TYPES = ['bank_transfer', 'cheque', 'card', 'cash'];

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

export default function PaymentChannelsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = !!user && user.roles.includes(FINANCE_ROLE);

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
          ? "You don't hold the payment-channel.manage permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the payment-channel list — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

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
          : 'Could not add the payment channel — try again.',
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
        err instanceof ApiError ? err.message : 'Could not disable it — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Payment channels</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The approved payment channels for customers (money in, on a collection
        receipt) and insurers (money out, on a remittance). Finance maintains
        this list; a channel is usable the moment it is added and stays so until
        it is disabled. Only the last few digits of an account are ever stored.
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
          <label style={labelStyle}>
            Owner
            <select
              aria-label="Owner type"
              value={ownerType}
              onChange={(e) => setOwnerType(e.target.value)}
            >
              <option value="customer">Customer</option>
              <option value="insurer">Insurer</option>
            </select>
          </label>
          <label style={labelStyle}>
            {ownerType === 'customer' ? 'Customer ID' : 'Insurer ID'}
            <input
              aria-label="Owner id"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Channel type
            <select
              aria-label="Channel type"
              value={channelType}
              onChange={(e) => setChannelType(e.target.value)}
            >
              {CHANNEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Label
            <input
              aria-label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Cairo Amman Bank — JOD"
              required
            />
          </label>
          <label style={labelStyle}>
            Bank name
            <input
              aria-label="Bank name"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            Account (last 2–4 digits)
            <input
              aria-label="Account last 4"
              value={accountLast4}
              onChange={(e) => setAccountLast4(e.target.value)}
              inputMode="numeric"
              maxLength={4}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add channel'}
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
          <p style={{ opacity: 0.6 }}>No payment channels yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>Owner</th>
                  <th style={headCellStyle}>Owner ID</th>
                  <th style={headCellStyle}>Type</th>
                  <th style={headCellStyle}>Label</th>
                  <th style={headCellStyle}>Bank</th>
                  <th style={headCellStyle}>Acct</th>
                  <th style={headCellStyle}>Status</th>
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
                      {r.isActive ? <strong>Active</strong> : 'Disabled'}
                    </td>
                    <td style={cellStyle}>
                      {canManage && r.isActive ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void disable(r.id)}
                        >
                          Disable
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
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
