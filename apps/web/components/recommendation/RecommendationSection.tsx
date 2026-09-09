'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  approveRecommendation,
  discloseConflictOfInterest,
  downloadRecommendationDocument,
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
import { useLanguage } from '../../lib/i18n/language-context';
import { formatMoney } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

const FACTOR_LABEL_KEY: Record<keyof RationaleFactors, TranslationKey> = {
  coverage: 'recFactorCoverage',
  price: 'recFactorPrice',
  financialStrength: 'recFactorFinancialStrength',
  claimsService: 'recFactorClaimsService',
  deductible: 'recFactorDeductible',
  policyConditions: 'recFactorPolicyConditions',
};

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

export function RecommendationSection({
  opportunity,
  isPlacement,
  isManager,
  isCompliance,
  onOpportunityChanged,
}: Props) {
  const { language, t } = useLanguage();
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
          : t('recLoadError'),
      );
    }
  }, [opportunity.id, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass.
  // The button is only rendered once blockedFromSend is empty (see
  // below), so this call should never actually hit the api's own 422 —
  // the try/catch here is a safety net for a race (e.g. a threshold
  // changing between render and click), not the expected path.
  async function downloadDocument(id: string) {
    setFormError(null);
    try {
      const blob = await downloadRecommendationDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recommendation-report-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('recDownloadError'),
      );
    }
  }

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
          : t('recActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  const currentQuotes = chains.map((c) => c.current);

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>{t('recSectionHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('recSectionIntro')}</p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {isManager ? (
        <div style={{ ...quoteFieldStyle, maxWidth: '22rem', marginTop: '1rem' }}>
          <label htmlFor="rec-threshold">
            {t('recThresholdLabel')}{' '}
            <span style={{ opacity: 0.6 }}>
              {t('recThresholdCurrent', {
                amount: formatMoney(opportunity.targetPremiumThreshold, language),
              })}
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
              {t('recSetButton')}
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
              {t('recClearButton')}
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
        <p>{t('commonLoading')}</p>
      ) : rec === null ? (
        isPlacement ? (
          <div style={{ marginTop: '1rem', maxWidth: '40rem' }}>
            <strong>{t('recDraftHeading')}</strong>
            <div style={quoteFieldStyle}>
              <label htmlFor="rec-quote">{t('recQuoteLabel')}</label>
              <select
                id="rec-quote"
                value={quotationId}
                onChange={(e) => setQuotationId(e.target.value)}
              >
                <option value="">{t('recSelectQuoteOption')}</option>
                {currentQuotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.insurer.name} — {formatMoney(q.premium, language, q.currency)}
                    {q.commissionRatePercent
                      ? t('recCommissionSuffix', { percent: q.commissionRatePercent })
                      : ''}
                  </option>
                ))}
              </select>
              {currentQuotes.length === 0 ? (
                <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                  {t('recNoCurrentQuotes')}
                </span>
              ) : null}
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="rec-rationale">{t('recRationaleLabel')}</label>
              <textarea
                id="rec-rationale"
                value={rationale}
                rows={3}
                maxLength={8000}
                onChange={(e) => setRationale(e.target.value)}
              />
            </div>
            {RATIONALE_FACTOR_FIELDS.map(({ key }) => (
              <div key={key} style={quoteFieldStyle}>
                <label htmlFor={`rec-f-${key}`}>{t(FACTOR_LABEL_KEY[key])}</label>
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
              {busy ? t('recDraftingButton') : t('recDraftButton')}
            </button>
          </div>
        ) : (
          <p style={{ opacity: 0.6, marginTop: '1rem' }}>
            {t('recNoneYet')}
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
                ? t('recSentToClientBadge')
                : rec.blockedFromSend.length === 0
                  ? t('recReadyToSendBadge')
                  : t('recBlockedBadge')}
            </span>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            {rec.recommendedQuotation.insuranceLine} ·{' '}
            {formatMoney(
              rec.recommendedQuotation.premium,
              language,
              rec.recommendedQuotation.currency,
            )}
            {rec.recommendedQuotation.commissionRatePercent
              ? t('recCommissionSuffix', { percent: rec.recommendedQuotation.commissionRatePercent })
              : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: '0.4rem 0' }}>
            {rec.rationale}
          </p>
          <dl style={{ margin: '0.4rem 0' }}>
            {RATIONALE_FACTOR_FIELDS.map(({ key }) => (
              <div key={key} style={{ marginBottom: '0.3rem' }}>
                <dt style={{ fontWeight: 600, fontSize: '0.8rem', opacity: 0.7 }}>
                  {t(FACTOR_LABEL_KEY[key])}
                </dt>
                <dd style={{ margin: 0 }}>{rec.rationaleFactors[key]}</dd>
              </div>
            ))}
          </dl>

          <p style={{ margin: '0.4rem 0' }}>
            {t('recApprovalLabel')}{' '}
            {!rec.approvalRequired
              ? t('recApprovalNotRequired')
              : rec.approvedByUserId
                ? t('recApprovalApproved')
                : t('recApprovalRequiredAwaiting')}
          </p>
          <p style={{ margin: '0.4rem 0' }}>
            {t('recCoiLabel')}{' '}
            {!rec.conflictOfInterestFlagged
              ? t('recCoiNone')
              : rec.conflictOfInterestDisclosure
                ? t('recCoiDisclosed')
                : t('recCoiFlagged', { percent: rec.coiCommissionDiffPercent ?? '' })}
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
                {t('recApproveButton')}
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
                {t('recSendButton')}
              </button>
            ) : null}
            {rec.blockedFromSend.length === 0 ? (
              <button
                type="button"
                onClick={() => void downloadDocument(rec.id)}
                style={{ ...buttonStyle, width: 'auto' }}
              >
                {t('recDownloadReportButton')}
              </button>
            ) : null}
          </div>

          {(isPlacement || isCompliance) &&
          rec.conflictOfInterestFlagged &&
          !rec.conflictOfInterestDisclosure &&
          !rec.sentToClientAt ? (
            <div style={{ ...quoteFieldStyle, marginTop: '0.8rem' }}>
              <label htmlFor="rec-coi">{t('recCoiDisclosureLabel')}</label>
              <textarea
                id="rec-coi"
                value={disclosureText}
                rows={3}
                maxLength={8000}
                placeholder={t('recCoiDisclosurePlaceholder')}
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
                {t('recRecordDisclosureButton')}
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
              <strong>{t('recDisclosedLabel')}</strong>{' '}
              {rec.conflictOfInterestDisclosure.disclosureText}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
