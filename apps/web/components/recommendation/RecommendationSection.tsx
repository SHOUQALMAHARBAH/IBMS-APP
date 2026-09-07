'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  approveRecommendation,
  discloseConflictOfInterest,
  draftRecommendation,
  listRecommendationsForOpportunity,
  sendRecommendation,
  RATIONALE_FACTOR_FIELDS,
  type RationaleFactors,
  type Recommendation,
} from '../../lib/recommendation/recommendation-api';
import {
  listQuotationsForOpportunity,
  type QuotationChain,
} from '../../lib/quotation/quotation-api';
import {
  setTargetPremiumThreshold,
  type OpportunityWithContext,
} from '../../lib/opportunity/opportunity-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunity: OpportunityWithContext;
  isPlacement: boolean;
  isManager: boolean;
  isCompliance: boolean;
  onOpportunityChanged: () => void;
}

const EMPTY_FACTORS: RationaleFactors = {
  coverage: '',
  price: '',
  financialStrength: '',
  claimsService: '',
  deductible: '',
  policyConditions: '',
};

function money(value: string | null, currency = 'JOD'): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `${currency} ${value}`;
}

export function RecommendationSection({
  opportunity,
  isPlacement,
  isManager,
  isCompliance,
  onOpportunityChanged,
}: Props) {
  const [rec, setRec] = useState<Recommendation | null | undefined>(undefined);
  const [chains, setChains] = useState<QuotationChain[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [quotationId, setQuotationId] = useState('');
  const [rationale, setRationale] = useState('');
  const [factors, setFactors] = useState<RationaleFactors>(EMPTY_FACTORS);
  const [thresholdInput, setThresholdInput] = useState('');
  const [disclosureText, setDisclosureText] = useState('');

  const load = useCallback(async () => {
    try {
      const [recs, qs] = await Promise.all([
        listRecommendationsForOpportunity(opportunity.id),
        listQuotationsForOpportunity(opportunity.id).catch(() => []),
      ]);
      setRec(recs[0] ?? null);
      setChains(qs);
      setLoadError(null);
    } catch (err) {
      setRec(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the recommendation — try again.',
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

  const currentQuotes = chains.map((c) => c.current);

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>Broker recommendation</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        Documented rationale on all six factors. Above the Opportunity&apos;s
        target premium threshold it needs senior-officer approval; a
        materially higher-commission pick over a comparable quote needs a
        conflict-of-interest disclosure — both before it can be sent.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {isManager ? (
        <div style={{ ...quoteFieldStyle, maxWidth: '22rem', marginTop: '1rem' }}>
          <label htmlFor="rec-threshold">
            Target premium threshold{' '}
            <span style={{ opacity: 0.6 }}>
              (current: {money(opportunity.targetPremiumThreshold)})
            </span>
          </label>
          <input
            id="rec-threshold"
            value={thresholdInput}
            inputMode="decimal"
            placeholder="250000.000"
            onChange={(e) => setThresholdInput(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
            <button
              type="button"
              disabled={busy || thresholdInput.trim().length === 0}
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() =>
                void run(async () => {
                  await setTargetPremiumThreshold(
                    opportunity.id,
                    thresholdInput.trim(),
                  );
                  setThresholdInput('');
                  onOpportunityChanged();
                })
              }
            >
              Set
            </button>
            <button
              type="button"
              disabled={busy}
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() =>
                void run(async () => {
                  await setTargetPremiumThreshold(opportunity.id, null);
                  onOpportunityChanged();
                })
              }
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}

      {rec === undefined ? (
        <p>Loading…</p>
      ) : rec === null ? (
        isPlacement ? (
          <div style={{ marginTop: '1rem', maxWidth: '40rem' }}>
            <strong>Draft the recommendation</strong>
            <div style={quoteFieldStyle}>
              <label htmlFor="rec-quote">Recommended quotation</label>
              <select
                id="rec-quote"
                value={quotationId}
                onChange={(e) => setQuotationId(e.target.value)}
              >
                <option value="">Select the recommended quote…</option>
                {currentQuotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.insurer.name} — {money(q.premium, q.currency)}
                    {q.commissionRatePercent
                      ? ` · ${q.commissionRatePercent}% commission`
                      : ''}
                  </option>
                ))}
              </select>
              {currentQuotes.length === 0 ? (
                <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                  No current-version quotations on this opportunity yet.
                </span>
              ) : null}
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="rec-rationale">Overall rationale</label>
              <textarea
                id="rec-rationale"
                value={rationale}
                rows={3}
                maxLength={8000}
                onChange={(e) => setRationale(e.target.value)}
              />
            </div>
            {RATIONALE_FACTOR_FIELDS.map(({ key, label }) => (
              <div key={key} style={quoteFieldStyle}>
                <label htmlFor={`rec-f-${key}`}>{label}</label>
                <textarea
                  id={`rec-f-${key}`}
                  value={factors[key]}
                  rows={2}
                  maxLength={2000}
                  onChange={(e) =>
                    setFactors((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              disabled={busy || !quotationId || rationale.trim().length < 10}
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() =>
                void run(() =>
                  draftRecommendation({
                    opportunityId: opportunity.id,
                    recommendedQuotationId: quotationId,
                    rationale: rationale.trim(),
                    rationaleFactors: factors,
                  }),
                )
              }
            >
              {busy ? 'Drafting…' : 'Draft recommendation'}
            </button>
          </div>
        ) : (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>
            No recommendation drafted yet.
          </p>
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
            <strong>{rec.recommendedQuotation.insurer.name}</strong>
            <span style={rfqBadgeStyle}>
              {rec.sentToClientAt
                ? 'sent to client'
                : rec.blockedFromSend.length === 0
                  ? 'ready to send'
                  : 'blocked'}
            </span>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            {rec.recommendedQuotation.insuranceLine} ·{' '}
            {money(
              rec.recommendedQuotation.premium,
              rec.recommendedQuotation.currency,
            )}
            {rec.recommendedQuotation.commissionRatePercent
              ? ` · ${rec.recommendedQuotation.commissionRatePercent}% commission`
              : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: '0.4rem 0' }}>
            {rec.rationale}
          </p>
          <dl style={{ margin: '0.4rem 0' }}>
            {RATIONALE_FACTOR_FIELDS.map(({ key, label }) => (
              <div key={key} style={{ marginBottom: '0.3rem' }}>
                <dt style={{ fontWeight: 600, fontSize: '0.8rem', opacity: 0.7 }}>
                  {label}
                </dt>
                <dd style={{ margin: 0 }}>{rec.rationaleFactors[key]}</dd>
              </div>
            ))}
          </dl>

          <p style={{ margin: '0.4rem 0' }}>
            Approval:{' '}
            {!rec.approvalRequired
              ? 'not required (below threshold)'
              : rec.approvedByUserId
                ? 'approved'
                : 'required — awaiting a senior officer'}
          </p>
          <p style={{ margin: '0.4rem 0' }}>
            Conflict of interest:{' '}
            {!rec.conflictOfInterestFlagged
              ? 'none detected'
              : rec.conflictOfInterestDisclosure
                ? 'disclosed'
                : `flagged (recommended insurer earns ${rec.coiCommissionDiffPercent}% more commission than a comparable quote) — disclosure required`}
          </p>

          {rec.blockedFromSend.length > 0 ? (
            <ul style={{ color: 'var(--error, #c00)', margin: '0.4rem 0' }}>
              {rec.blockedFromSend.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}

          <div
            style={{
              display: 'flex',
              gap: '0.6rem',
              flexWrap: 'wrap',
              marginTop: '0.6rem',
            }}
          >
            {isManager &&
            rec.approvalRequired &&
            !rec.approvedByUserId &&
            !rec.sentToClientAt ? (
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(() => approveRecommendation(rec.id))
                }
              >
                Approve
              </button>
            ) : null}
            {isPlacement &&
            !rec.sentToClientAt &&
            rec.blockedFromSend.length === 0 ? (
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(async () => {
                    await sendRecommendation(rec.id);
                    onOpportunityChanged();
                  })
                }
              >
                Send to client
              </button>
            ) : null}
          </div>

          {(isPlacement || isCompliance) &&
          rec.conflictOfInterestFlagged &&
          !rec.conflictOfInterestDisclosure &&
          !rec.sentToClientAt ? (
            <div style={{ ...quoteFieldStyle, marginTop: '0.8rem' }}>
              <label htmlFor="rec-coi">Conflict-of-interest disclosure</label>
              <textarea
                id="rec-coi"
                value={disclosureText}
                rows={3}
                maxLength={8000}
                placeholder="What was disclosed to the client, and when."
                onChange={(e) => setDisclosureText(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || disclosureText.trim().length < 20}
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
                onClick={() =>
                  void run(() =>
                    discloseConflictOfInterest(
                      rec.id,
                      disclosureText.trim(),
                    ),
                  )
                }
              >
                Record disclosure
              </button>
            </div>
          ) : null}

          {rec.conflictOfInterestDisclosure ? (
            <p
              style={{
                whiteSpace: 'pre-wrap',
                marginTop: '0.6rem',
                opacity: 0.8,
                fontSize: '0.9rem',
              }}
            >
              <strong>Disclosed:</strong>{' '}
              {rec.conflictOfInterestDisclosure.disclosureText}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
