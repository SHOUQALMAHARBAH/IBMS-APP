'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  attachPolicyDocuments,
  checkPolicy,
  listPoliciesForOpportunity,
  placePolicy,
  recordPolicyIssuance,
  DATA_CLASSIFICATION_OPTIONS,
  DOCUMENT_CATEGORY_OPTIONS,
  type DataClassification,
  type DocumentCategory,
  type Policy,
  type PolicyDocumentInput,
} from '../../lib/policy/policy-api';
import type { OpportunityWithContext } from '../../lib/opportunity/opportunity-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunity: OpportunityWithContext;
  isPlacement: boolean;
  canCheck: boolean;
  onOpportunityChanged: () => void;
}

const CHECKABLE_STATES = new Set([
  'ISSUED',
  'DISCREPANCY',
  'CHECKING_IN_PROGRESS',
]);

/** The section only makes sense once the client has accepted (the Opportunity
 * reaches PLACEMENT) — or a Policy already exists (a status that lagged the
 * routing shouldn't hide a real placed policy). */
const POLICY_ELIGIBLE_STATES = new Set(['PLACEMENT']);

function money(value: string | null, currency = 'JOD'): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `${currency} ${value}`;
}

function emptyDocRow(): PolicyDocumentInput {
  return { category: 'POLICY', classification: 'CONFIDENTIAL', fileName: '', storageRef: '' };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function DocumentRowsEditor({
  rows,
  setRows,
}: {
  rows: PolicyDocumentInput[];
  setRows: (rows: PolicyDocumentInput[]) => void;
}) {
  function update(i: number, patch: Partial<PolicyDocumentInput>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '0.4rem',
            flexWrap: 'wrap',
            alignItems: 'center',
            margin: '0.3rem 0',
          }}
        >
          <select
            aria-label={`Document ${i + 1} category`}
            value={row.category}
            onChange={(e) => update(i, { category: e.target.value as DocumentCategory })}
          >
            {DOCUMENT_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label={`Document ${i + 1} classification`}
            value={row.classification}
            onChange={(e) =>
              update(i, { classification: e.target.value as DataClassification })
            }
          >
            {DATA_CLASSIFICATION_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            aria-label={`Document ${i + 1} file name`}
            placeholder="file name"
            value={row.fileName}
            onChange={(e) => update(i, { fileName: e.target.value })}
          />
          <input
            aria-label={`Document ${i + 1} storage reference`}
            placeholder="storage reference"
            value={row.storageRef}
            onChange={(e) => update(i, { storageRef: e.target.value })}
          />
          <button
            type="button"
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ ...buttonStyle, width: 'auto' }}
        onClick={() => setRows([...rows, emptyDocRow()])}
      >
        Add document
      </button>
    </div>
  );
}

export function PolicySection({
  opportunity,
  isPlacement,
  canCheck,
  onOpportunityChanged,
}: Props) {
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inceptionDate, setInceptionDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [policyNumber, setPolicyNumber] = useState('');
  const [issuedPremium, setIssuedPremium] = useState('');
  const [limitsText, setLimitsText] = useState('{\n  "buildings": "5000000.000"\n}');
  const [sumsInsuredText, setSumsInsuredText] = useState('{\n  "total": "5000000.000"\n}');
  const [namedPerilsText, setNamedPerilsText] = useState('fire, flood, theft');
  const [extensionsText, setExtensionsText] = useState('');
  const [issuanceDocs, setIssuanceDocs] = useState<PolicyDocumentInput[]>([
    emptyDocRow(),
  ]);

  const [attachDocs, setAttachDocs] = useState<PolicyDocumentInput[]>([emptyDocRow()]);

  // Process 20 — the checker's transcription of the Requested Coverage.
  const [chkLimitsText, setChkLimitsText] = useState(
    '{\n  "buildings": "5000000.000"\n}',
  );
  const [chkSumsText, setChkSumsText] = useState('{\n  "total": "5000000.000"\n}');
  const [chkPerilsText, setChkPerilsText] = useState('fire, flood, theft');
  const [chkExtensionsText, setChkExtensionsText] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await listPoliciesForOpportunity(opportunity.id);
      setPolicy(rows[0] ?? null);
      setLoadError(null);
    } catch (err) {
      setPolicy(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the policy — try again.',
      );
    }
  }, [opportunity.id]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'That action could not be completed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (policy === undefined) {
    return (
      <section>
        <h2 style={{ marginTop: '2.5rem' }}>Policy</h2>
        <p>Loading…</p>
      </section>
    );
  }
  if (policy === null && !POLICY_ELIGIBLE_STATES.has(opportunity.status)) {
    return null;
  }

  const limits = parseJsonObject(limitsText);
  const sumsInsured = parseJsonObject(sumsInsuredText);
  const issuanceReady =
    policyNumber.trim().length >= 2 &&
    issuedPremium.trim().length > 0 &&
    limits !== null &&
    sumsInsured !== null;

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>Policy</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        Placed once the client accepts; issuance records the insurer-issued
        policy number, premium, coverage schedule and documents.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}

      {policy === null ? (
        isPlacement ? (
          <div style={{ marginTop: '1rem', maxWidth: '30rem' }}>
            <div style={quoteFieldStyle}>
              <label htmlFor="pol-inception">Inception date</label>
              <input
                id="pol-inception"
                type="date"
                value={inceptionDate}
                onChange={(e) => setInceptionDate(e.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="pol-expiry">Expiry date (optional)</label>
              <input
                id="pol-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={busy || inceptionDate.trim().length === 0}
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() =>
                void run(async () => {
                  await placePolicy({
                    opportunityId: opportunity.id,
                    inceptionDate,
                    expiryDate: expiryDate.trim() || undefined,
                  });
                  onOpportunityChanged();
                })
              }
            >
              {busy ? 'Placing…' : 'Place policy'}
            </button>
          </div>
        ) : (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>No policy placed yet.</p>
        )
      ) : (
        <div style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <strong>{policy.insurer?.name ?? policy.insurerId}</strong>
            <span style={rfqBadgeStyle}>{policy.status}</span>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            {policy.insuranceLine}
            {policy.policyNumber ? ` · ${policy.policyNumber}` : ''}
          </p>
          <p style={{ margin: '0.4rem 0' }}>
            Requested {money(policy.requestedPremium, policy.currency)}
            {policy.issuedPremium
              ? ` · Issued ${money(policy.issuedPremium, policy.currency)}` +
                (policy.premiumVariance
                  ? ` (Δ ${money(policy.premiumVariance, policy.currency)})`
                  : '')
              : ''}
          </p>
          <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: '0.4rem 0' }}>
            Inception {policy.inceptionDate ? new Date(policy.inceptionDate).toLocaleDateString() : '—'}
            {' · '}
            Expiry {policy.expiryDate ? new Date(policy.expiryDate).toLocaleDateString() : '—'}
          </p>

          {policy.status === 'PLACEMENT_CONFIRMED' && isPlacement ? (
            <div style={{ marginTop: '0.8rem', maxWidth: '36rem' }}>
              <strong>Record insurer issuance</strong>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-number">Policy number</label>
                <input
                  id="pol-number"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-issued-premium">Issued premium</label>
                <input
                  id="pol-issued-premium"
                  inputMode="decimal"
                  placeholder="118500.000"
                  value={issuedPremium}
                  onChange={(e) => setIssuedPremium(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-limits">Limits (JSON)</label>
                <textarea
                  id="pol-limits"
                  rows={3}
                  value={limitsText}
                  onChange={(e) => setLimitsText(e.target.value)}
                />
                {limits === null ? (
                  <span style={{ ...errorStyle, fontSize: '0.8rem' }}>
                    Must be a non-empty JSON object.
                  </span>
                ) : null}
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-sums-insured">Sums insured (JSON)</label>
                <textarea
                  id="pol-sums-insured"
                  rows={3}
                  value={sumsInsuredText}
                  onChange={(e) => setSumsInsuredText(e.target.value)}
                />
                {sumsInsured === null ? (
                  <span style={{ ...errorStyle, fontSize: '0.8rem' }}>
                    Must be a non-empty JSON object.
                  </span>
                ) : null}
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-perils">Named perils (comma-separated)</label>
                <input
                  id="pol-perils"
                  value={namedPerilsText}
                  onChange={(e) => setNamedPerilsText(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-extensions">Extensions (comma-separated)</label>
                <input
                  id="pol-extensions"
                  value={extensionsText}
                  onChange={(e) => setExtensionsText(e.target.value)}
                />
              </div>
              <p style={{ fontWeight: 600, marginTop: '0.6rem' }}>
                Issued documents
              </p>
              <DocumentRowsEditor rows={issuanceDocs} setRows={setIssuanceDocs} />
              <button
                type="button"
                disabled={busy || !issuanceReady}
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.6rem' }}
                onClick={() =>
                  void run(() =>
                    recordPolicyIssuance(policy.id, {
                      policyNumber: policyNumber.trim(),
                      issuedPremium: issuedPremium.trim(),
                      schedule: {
                        limits: limits ?? {},
                        sumsInsured: sumsInsured ?? {},
                        namedPerils: splitList(namedPerilsText),
                        extensions: splitList(extensionsText),
                      },
                      documents: issuanceDocs.filter(
                        (d) => d.fileName.trim().length > 0 && d.storageRef.trim().length > 0,
                      ),
                    }),
                  )
                }
              >
                {busy ? 'Recording…' : 'Record issuance'}
              </button>
            </div>
          ) : null}

          {policy.schedules.length > 0 ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>Coverage schedule</p>
              {policy.schedules.map((s) => (
                <div key={s.id} style={{ fontSize: '0.9rem', margin: '0.3rem 0' }}>
                  Effective {new Date(s.effectiveFrom).toLocaleDateString()}
                  {s.effectiveTo
                    ? ` – ${new Date(s.effectiveTo).toLocaleDateString()}`
                    : ' – ongoing'}
                  {' · perils: '}
                  {s.namedPerils.join(', ') || '—'}
                  {' · extensions: '}
                  {s.extensions.join(', ') || '—'}
                </div>
              ))}
            </div>
          ) : null}

          {policy.documents.length > 0 ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>Electronic file documents</p>
              <ul style={{ margin: '0.3rem 0' }}>
                {policy.documents.map((d) => (
                  <li key={d.id} style={{ fontSize: '0.9rem' }}>
                    {d.category} · {d.classification} · {d.fileName} (v{d.versionNumber})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isPlacement && policy.status !== 'PLACEMENT_CONFIRMED' ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>Attach a document</p>
              <DocumentRowsEditor rows={attachDocs} setRows={setAttachDocs} />
              <button
                type="button"
                disabled={
                  busy ||
                  attachDocs.every(
                    (d) => d.fileName.trim().length === 0 || d.storageRef.trim().length === 0,
                  )
                }
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
                onClick={() =>
                  void run(async () => {
                    await attachPolicyDocuments(
                      policy.id,
                      attachDocs.filter(
                        (d) =>
                          d.fileName.trim().length > 0 && d.storageRef.trim().length > 0,
                      ),
                    );
                    setAttachDocs([emptyDocRow()]);
                  })
                }
              >
                Attach
              </button>
            </div>
          ) : null}

          {policy.checking ? (
            <div
              style={{
                marginTop: '0.8rem',
                padding: '0.6rem',
                borderLeft: `3px solid ${policy.checking.discrepancyFound ? 'var(--error, #c00)' : 'var(--ok, #2a7)'}`,
              }}
            >
              <p style={{ fontWeight: 600, margin: 0 }}>
                Quality-control check:{' '}
                {policy.checking.discrepancyFound
                  ? 'DISCREPANCY — Delivery blocked'
                  : 'verified'}
              </p>
              {policy.checking.discrepancyDetail ? (
                <p style={{ margin: '0.3rem 0', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                  {policy.checking.discrepancyDetail}
                </p>
              ) : null}
              {policy.checking.discrepancyLoggedAsPiRiskEvent ? (
                <p style={{ margin: '0.3rem 0', fontSize: '0.85rem', opacity: 0.75 }}>
                  A Professional Indemnity risk event has been logged.
                </p>
              ) : null}
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', opacity: 0.6 }}>
                Checked by {policy.checking.checkedByUserId ?? '—'}
                {policy.checking.checkedAt
                  ? ` on ${new Date(policy.checking.checkedAt).toLocaleString()}`
                  : ''}
              </p>
            </div>
          ) : null}

          {canCheck && CHECKABLE_STATES.has(policy.status) ? (
            <div style={{ marginTop: '0.8rem', maxWidth: '36rem' }}>
              <strong>
                {policy.checking ? 'Re-run the quality-control check' : 'Quality-control check'}
              </strong>
              <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: '0.2rem 0' }}>
                Enter the Requested Coverage — the system compares it line-by-line
                against the issued schedule. A discrepancy blocks Delivery and
                logs a PI risk event. You cannot check a policy you placed.
              </p>
              <div style={quoteFieldStyle}>
                <label htmlFor="chk-limits">Requested limits (JSON)</label>
                <textarea
                  id="chk-limits"
                  rows={3}
                  value={chkLimitsText}
                  onChange={(e) => setChkLimitsText(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="chk-sums">Requested sums insured (JSON)</label>
                <textarea
                  id="chk-sums"
                  rows={3}
                  value={chkSumsText}
                  onChange={(e) => setChkSumsText(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="chk-perils">Requested named perils (comma-separated)</label>
                <input
                  id="chk-perils"
                  value={chkPerilsText}
                  onChange={(e) => setChkPerilsText(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="chk-extensions">Requested extensions (comma-separated)</label>
                <input
                  id="chk-extensions"
                  value={chkExtensionsText}
                  onChange={(e) => setChkExtensionsText(e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={
                  busy ||
                  parseJsonObject(chkLimitsText) === null ||
                  parseJsonObject(chkSumsText) === null
                }
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
                onClick={() =>
                  void run(async () => {
                    await checkPolicy(policy.id, {
                      limits: parseJsonObject(chkLimitsText) ?? {},
                      sumsInsured: parseJsonObject(chkSumsText) ?? {},
                      namedPerils: splitList(chkPerilsText),
                      extensions: splitList(chkExtensionsText),
                    });
                    onOpportunityChanged();
                  })
                }
              >
                {busy ? 'Checking…' : 'Run check'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
