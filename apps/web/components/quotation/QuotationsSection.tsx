'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  captureQuotation,
  listQuotationsForRfq,
  reviseQuotation,
  type QuotationChain,
  type QuotationTermsInput,
  type QuotationVersion,
} from '../../lib/quotation/quotation-api';
import { ApiError } from '../../lib/auth/api-client';
import type { RfqInsurerSubmission } from '../../lib/rfq/rfq-api';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import {
  rfqBadgeStyle,
  rfqCellStyle,
  rfqTableStyle,
} from '../rfq/rfq.styles';
import {
  quoteChainCardStyle,
  quoteFieldStyle,
  quoteFormGridStyle,
  quoteHistoryPreStyle,
  quoteTermGridStyle,
  quoteTermLabelStyle,
  quoteTermValueStyle,
} from './quotation.styles';

interface Props {
  rfqId: string;
  isPlacement: boolean;
  submissions: RfqInsurerSubmission[];
}

/** The quote terms form model — every field a string so the inputs are
 * controlled; empty strings are dropped before the request. */
interface FormState {
  premium: string;
  currency: string;
  deductible: string;
  biPeriodMonths: string;
  liabilityLimit: string;
  commissionRatePercent: string;
  exclusions: string;
  conditions: string;
}

const EMPTY_FORM: FormState = {
  premium: '',
  currency: 'JOD',
  deductible: '',
  biPeriodMonths: '',
  liabilityLimit: '',
  commissionRatePercent: '',
  exclusions: '',
  conditions: '',
};

function formFor(version: QuotationVersion): FormState {
  return {
    premium: version.premium,
    currency: version.currency,
    deductible: version.deductible ?? '',
    biPeriodMonths:
      version.biPeriodMonths === null ? '' : String(version.biPeriodMonths),
    liabilityLimit: version.liabilityLimit ?? '',
    commissionRatePercent: version.commissionRatePercent ?? '',
    exclusions: version.exclusions ?? '',
    conditions: version.conditions ?? '',
  };
}

function toTermsInput(form: FormState): QuotationTermsInput {
  const trimmed = (v: string) => (v.trim().length > 0 ? v.trim() : undefined);
  const bi = trimmed(form.biPeriodMonths);
  return {
    premium: form.premium.trim(),
    currency: trimmed(form.currency),
    deductible: trimmed(form.deductible),
    liabilityLimit: trimmed(form.liabilityLimit),
    commissionRatePercent: trimmed(form.commissionRatePercent),
    exclusions: trimmed(form.exclusions),
    conditions: trimmed(form.conditions),
    biPeriodMonths: bi === undefined ? undefined : Number(bi),
  };
}

function fmtMoney(value: string | null, currency: string): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `${currency} ${value}`;
}

function fmtDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function QuotationsSection({ rfqId, isPlacement, submissions }: Props) {
  const [chains, setChains] = useState<QuotationChain[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // null = the capture form (a new insurer); a quotation id = revise that chain.
  const [mode, setMode] = useState<'capture' | { reviseId: string }>('capture');
  const [captureInsurerId, setCaptureInsurerId] = useState<string>('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setChains(await listQuotationsForRfq(rfqId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load quotations — try again.',
      );
    }
  }, [rfqId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startCapture() {
    setMode('capture');
    setForm(EMPTY_FORM);
    setCaptureInsurerId('');
    setFormError(null);
  }

  function startRevise(chain: QuotationChain) {
    setMode({ reviseId: chain.current.id });
    setForm(formFor(chain.current));
    setFormError(null);
  }

  async function submit() {
    if (form.premium.trim().length === 0) {
      setFormError('Premium is required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (mode === 'capture') {
        if (!captureInsurerId) {
          setFormError('Pick the insurer this quote is from.');
          setBusy(false);
          return;
        }
        await captureQuotation({
          rfqId,
          insurerId: captureInsurerId,
          ...toTermsInput(form),
        });
      } else {
        await reviseQuotation(mode.reviseId, toTermsInput(form));
      }
      startCapture();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Could not save the quotation — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const chainInsurerIds = new Set((chains ?? []).map((c) => c.insurerId));
  // A quote can only come from a shortlisted insurer that has not declined
  // and does not already have a chain (revise that one instead).
  const capturable = submissions.filter(
    (s) => s.status !== 'DECLINED' && !chainInsurerIds.has(s.insurerId),
  );

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>Quotations</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        One version chain per insurer. A renegotiation is saved as a new
        version — the previous terms are kept, never overwritten.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {chains === null ? (
        <p>Loading…</p>
      ) : chains.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No quotations captured yet.</p>
      ) : (
        chains.map((chain) => {
          const c = chain.current;
          const isOpen = expanded.has(chain.insurerId);
          return (
            <div key={chain.insurerId} style={quoteChainCardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <strong>{chain.insurer.name}</strong>
                <span style={rfqBadgeStyle}>
                  v{c.versionNumber} · {chain.versions.length} version
                  {chain.versions.length === 1 ? '' : 's'}
                </span>
              </div>

              <div style={quoteTermGridStyle}>
                <div>
                  <span style={quoteTermLabelStyle}>Premium</span>
                  <span style={quoteTermValueStyle}>
                    {fmtMoney(c.premium, c.currency)}
                  </span>
                </div>
                <div>
                  <span style={quoteTermLabelStyle}>Deductible</span>
                  <span style={quoteTermValueStyle}>
                    {fmtMoney(c.deductible, c.currency)}
                  </span>
                </div>
                <div>
                  <span style={quoteTermLabelStyle}>Liability limit</span>
                  <span style={quoteTermValueStyle}>
                    {fmtMoney(c.liabilityLimit, c.currency)}
                  </span>
                </div>
                <div>
                  <span style={quoteTermLabelStyle}>BI period</span>
                  <span style={quoteTermValueStyle}>
                    {c.biPeriodMonths === null
                      ? '—'
                      : `${c.biPeriodMonths} month${c.biPeriodMonths === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div>
                  <span style={quoteTermLabelStyle}>Commission rate</span>
                  <span style={quoteTermValueStyle}>
                    {c.commissionRatePercent === null
                      ? '—'
                      : `${c.commissionRatePercent}%`}
                  </span>
                </div>
              </div>

              {c.exclusions ? (
                <p style={quoteHistoryPreStyle}>
                  <span style={quoteTermLabelStyle}>Exclusions</span>
                  {c.exclusions}
                </p>
              ) : null}
              {c.conditions ? (
                <p style={quoteHistoryPreStyle}>
                  <span style={quoteTermLabelStyle}>Conditions</span>
                  {c.conditions}
                </p>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  marginTop: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                {chain.versions.length > 1 ? (
                  <button
                    type="button"
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(chain.insurerId))
                          next.delete(chain.insurerId);
                        else next.add(chain.insurerId);
                        return next;
                      })
                    }
                  >
                    {isOpen ? 'Hide history' : 'Version history'}
                  </button>
                ) : null}
                {isPlacement ? (
                  <button
                    type="button"
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() => startRevise(chain)}
                  >
                    Revise (new version)
                  </button>
                ) : null}
              </div>

              {isOpen ? (
                <table style={rfqTableStyle}>
                  <thead>
                    <tr>
                      <th style={rfqCellStyle}>Version</th>
                      <th style={rfqCellStyle}>Premium</th>
                      <th style={rfqCellStyle}>Deductible</th>
                      <th style={rfqCellStyle}>Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.versions.map((v) => (
                      <tr key={v.id}>
                        <td style={rfqCellStyle}>
                          v{v.versionNumber}
                          {v.isCurrentVersion ? (
                            <span style={{ ...rfqBadgeStyle, marginLeft: '0.4rem' }}>
                              current
                            </span>
                          ) : null}
                        </td>
                        <td style={rfqCellStyle}>
                          {fmtMoney(v.premium, v.currency)}
                        </td>
                        <td style={rfqCellStyle}>
                          {fmtMoney(v.deductible, v.currency)}
                        </td>
                        <td style={rfqCellStyle}>{fmtDateTime(v.receivedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          );
        })
      )}

      {isPlacement ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '40rem' }}>
          <strong>
            {mode === 'capture'
              ? 'Capture a quote'
              : 'Revise — save a new version'}
          </strong>
          {formError ? (
            <p role="alert" style={errorStyle}>
              {formError}
            </p>
          ) : null}

          {mode === 'capture' ? (
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-insurer">Insurer</label>
              <select
                id="quote-insurer"
                value={captureInsurerId}
                onChange={(e) => setCaptureInsurerId(e.target.value)}
              >
                <option value="">Select an insurer…</option>
                {capturable.map((s) => (
                  <option key={s.insurerId} value={s.insurerId}>
                    {s.insurer.name}
                  </option>
                ))}
              </select>
              {capturable.length === 0 ? (
                <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                  Every shortlisted insurer already has a quotation (revise it)
                  or has declined.
                </span>
              ) : null}
            </div>
          ) : (
            <p style={{ opacity: 0.7, margin: '0.5rem 0' }}>
              Revising the current version. rfqId / insurer are inherited.{' '}
              <button
                type="button"
                style={{
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  color: 'inherit',
                }}
                onClick={startCapture}
              >
                Cancel
              </button>
            </p>
          )}

          <div style={quoteFormGridStyle}>
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-premium">Premium *</label>
              <input
                id="quote-premium"
                value={form.premium}
                inputMode="decimal"
                placeholder="125000.500"
                onChange={(e) => set('premium', e.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-currency">Currency</label>
              <input
                id="quote-currency"
                value={form.currency}
                maxLength={3}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-deductible">Deductible</label>
              <input
                id="quote-deductible"
                value={form.deductible}
                inputMode="decimal"
                onChange={(e) => set('deductible', e.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-liability">Liability limit</label>
              <input
                id="quote-liability"
                value={form.liabilityLimit}
                inputMode="decimal"
                onChange={(e) => set('liabilityLimit', e.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-bi">BI period (months)</label>
              <input
                id="quote-bi"
                value={form.biPeriodMonths}
                inputMode="numeric"
                onChange={(e) => set('biPeriodMonths', e.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="quote-commission">Commission rate %</label>
              <input
                id="quote-commission"
                value={form.commissionRatePercent}
                inputMode="decimal"
                onChange={(e) => set('commissionRatePercent', e.target.value)}
              />
            </div>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="quote-exclusions">Exclusions</label>
            <textarea
              id="quote-exclusions"
              value={form.exclusions}
              rows={2}
              maxLength={4000}
              onChange={(e) => set('exclusions', e.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="quote-conditions">Conditions</label>
            <textarea
              id="quote-conditions"
              value={form.conditions}
              rows={2}
              maxLength={4000}
              onChange={(e) => set('conditions', e.target.value)}
            />
          </div>

          <button
            type="button"
            disabled={busy || form.premium.trim().length === 0}
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() => void submit()}
          >
            {busy
              ? 'Saving…'
              : mode === 'capture'
                ? 'Capture quote'
                : 'Save new version'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
