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

const COMPLIANCE_ROLE = 'COMPLIANCE_OFFICER';
const MANAGER_ROLE = 'BRANCH_DEPARTMENT_MANAGER';

function pct(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : v;
}

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

export default function CommissionRatesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage =
    !!user &&
    (user.roles.includes(COMPLIANCE_ROLE) ||
      user.roles.includes(MANAGER_ROLE));

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
            : 'Could not load the commission rate table — try again.',
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
          : 'Could not open the rate window — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Commission rates</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        The governed commission-rate table, by insurer and insurance line. A
        rate change opens a new window and closes the prior one at the same
        instant — only one window is ever open per pair. Finance applies these
        rates to policies; Compliance and Managers alter the table.
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
              aria-label="Insurer"
              value={insurerId}
              onChange={(e) => setInsurerId(e.target.value)}
              required
            >
              <option value="">Select an insurer…</option>
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
              aria-label="Insurance line"
              value={insuranceLine}
              onChange={(e) => setInsuranceLine(e.target.value)}
              placeholder="Property All Risks"
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Rate %
            <input
              aria-label="Rate percent"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="15"
              inputMode="decimal"
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            VAT %
            <input
              aria-label="VAT rate percent"
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
              aria-label="Effective from"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Open rate window'}
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
          <p style={{ opacity: 0.6 }}>No commission agreements yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '42rem' }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>Insurer</th>
                  <th style={headCellStyle}>Insurance line</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>Rate</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>VAT</th>
                  <th style={headCellStyle}>Effective from</th>
                  <th style={headCellStyle}>Effective to</th>
                  <th style={headCellStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cellStyle}>{r.insurerName}</td>
                    <td style={cellStyle}>{r.insuranceLine}</td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      {pct(r.ratePercent)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                      {pct(r.vatRatePercent)}
                    </td>
                    <td style={cellStyle}>{r.effectiveFrom.slice(0, 10)}</td>
                    <td style={cellStyle}>
                      {r.effectiveTo ? r.effectiveTo.slice(0, 10) : '—'}
                    </td>
                    <td style={cellStyle}>
                      {r.isOpen ? <strong>Open</strong> : 'Closed'}
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
