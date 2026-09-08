'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  captureClientDecision,
  listClientDecisionsForOpportunity,
  DECISION_TYPE_OPTIONS,
  EVIDENCE_TYPE_OPTIONS,
  type ClientDecision,
  type ClientDecisionRoute,
  type ClientDecisionType,
  type EvidenceType,
} from '../../lib/client-decision/client-decision-api';
import {
  type OpportunityStatus,
  type OpportunityWithContext,
} from '../../lib/opportunity/opportunity-api';
import { ApiError } from '../../lib/auth/api-client';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatDateTime } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunity: OpportunityWithContext;
  canCapture: boolean;
  onOpportunityChanged: () => void;
}

const DECISION_TYPE_LABEL_KEY: Record<ClientDecisionType, TranslationKey> = {
  ACCEPT: 'cdTypeAccept',
  REJECT: 'cdTypeReject',
  REQUEST_FURTHER_NEGOTIATION: 'cdTypeFurtherNegotiation',
  REQUEST_ALTERNATIVE_OPTIONS: 'cdTypeAlternativeOptions',
  REQUEST_PRICE_REDUCTION: 'cdTypePriceReduction',
  REQUEST_COVERAGE_INCREASE: 'cdTypeCoverageIncrease',
};

const EVIDENCE_TYPE_LABEL_KEY: Record<EvidenceType, TranslationKey> = {
  'e-signature': 'cdEvidenceESignature',
  signature: 'cdEvidenceSignature',
  email_confirmation: 'cdEvidenceEmailConfirmation',
};

const ROUTE_LABEL_KEY: Record<ClientDecisionRoute, TranslationKey> = {
  PLACEMENT: 'cdRoutePlacement',
  CLOSED_LOST: 'cdRouteClosedLost',
  RENEGOTIATE: 'cdRouteRenegotiate',
};

const OPPORTUNITY_STATUS_LABEL_KEY: Record<OpportunityStatus, TranslationKey> = {
  NEEDS_CONFIRMED: 'oppStatusNeedsConfirmed',
  RFQ_ISSUED: 'oppStatusRfqIssued',
  QUOTES_RECEIVED: 'oppStatusQuotesReceived',
  COMPARISON_BUILT: 'oppStatusComparisonBuilt',
  RECOMMENDATION_DRAFTED: 'oppStatusRecommendationDrafted',
  SENT_TO_CLIENT: 'oppStatusSentToClient',
  CLIENT_DECISION: 'oppStatusClientDecision',
  PLACEMENT: 'oppStatusPlacement',
  RENEGOTIATE: 'oppStatusRenegotiate',
  CLOSED_LOST: 'oppStatusClosedLost',
};

const DECISION_STATES = new Set([
  'SENT_TO_CLIENT',
  'CLIENT_DECISION',
  'PLACEMENT',
  'CLOSED_LOST',
  'RENEGOTIATE',
]);

export function ClientDecisionSection({
  opportunity,
  canCapture,
  onOpportunityChanged,
}: Props) {
  const { language, t } = useLanguage();
  const [decision, setDecision] = useState<ClientDecision | null | undefined>(
    undefined,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [decisionType, setDecisionType] =
    useState<ClientDecisionType>('ACCEPT');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('e-signature');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await listClientDecisionsForOpportunity(opportunity.id);
      setDecision(rows[0] ?? null);
      setLoadError(null);
    } catch (err) {
      setDecision(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : t('cdLoadError'),
      );
    }
  }, [opportunity.id, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function submit() {
    if (evidenceRef.trim().length < 2) {
      setFormError(t('cdEvidenceRefRequiredError'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await captureClientDecision({
        opportunityId: opportunity.id,
        decision: decisionType,
        evidenceType,
        evidenceRef: evidenceRef.trim(),
        notes: notes.trim() || undefined,
      });
      await load();
      onOpportunityChanged();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('cdRecordError'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Nothing to show until a recommendation could have been sent.
  if (decision === undefined) {
    return (
      <section>
        <h2 style={{ marginTop: '2.5rem' }}>{t('cdSectionHeading')}</h2>
        <p>{t('commonLoading')}</p>
      </section>
    );
  }
  if (decision === null && !DECISION_STATES.has(opportunity.status)) {
    return null;
  }

  const evidenceTypeLabel =
    decision?.evidenceType && decision.evidenceType in EVIDENCE_TYPE_LABEL_KEY
      ? t(EVIDENCE_TYPE_LABEL_KEY[decision.evidenceType as EvidenceType])
      : (decision?.evidenceType ?? '—');

  const opportunityStatusLabel =
    decision && decision.opportunityStatus in OPPORTUNITY_STATUS_LABEL_KEY
      ? t(OPPORTUNITY_STATUS_LABEL_KEY[decision.opportunityStatus as OpportunityStatus])
      : (decision?.opportunityStatus ?? '');

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>{t('cdSectionHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('cdSectionIntro')}</p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {decision ? (
        <div style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <strong>{t(DECISION_TYPE_LABEL_KEY[decision.decision])}</strong>
            <span style={rfqBadgeStyle}>
              {t(ROUTE_LABEL_KEY[decision.route])}
              {decision.routingComplete ? '' : ` ${t('cdRoutingIncompleteSuffix')}`}
            </span>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            {t('cdEvidenceLabel')} {evidenceTypeLabel}
            {decision.evidenceRef ? ` · ${decision.evidenceRef}` : ''}
          </p>
          {decision.notes ? (
            <p style={{ whiteSpace: 'pre-wrap', margin: '0.4rem 0' }}>
              {decision.notes}
            </p>
          ) : null}
          <p style={{ opacity: 0.6, fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
            {t('cdRecordedMeta', {
              date: formatDateTime(decision.decidedAt, language),
              status: opportunityStatusLabel,
            })}
          </p>
        </div>
      ) : canCapture ? (
        <div style={{ marginTop: '1rem', maxWidth: '36rem' }}>
          {formError ? (
            <p role="alert" style={errorStyle}>
              {formError}
            </p>
          ) : null}
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-decision">{t('cdDecisionLabel')}</label>
            <select
              id="cd-decision"
              value={decisionType}
              onChange={(e) =>
                setDecisionType(e.target.value as ClientDecisionType)
              }
            >
              {DECISION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(DECISION_TYPE_LABEL_KEY[o.value])}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-evidence-type">{t('cdEvidenceTypeLabel')}</label>
            <select
              id="cd-evidence-type"
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
            >
              {EVIDENCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(EVIDENCE_TYPE_LABEL_KEY[o.value])}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-evidence-ref">{t('cdEvidenceRefLabel')}</label>
            <input
              id="cd-evidence-ref"
              value={evidenceRef}
              maxLength={500}
              placeholder={t('cdEvidenceRefPlaceholder')}
              onChange={(e) => setEvidenceRef(e.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="cd-notes">{t('cdNotesLabel')}</label>
            <textarea
              id="cd-notes"
              value={notes}
              rows={2}
              maxLength={8000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || evidenceRef.trim().length < 2}
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() => void submit()}
          >
            {busy ? t('cdRecordingButton') : t('cdRecordButton')}
          </button>
        </div>
      ) : (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          {t('cdNoneYet')}
        </p>
      )}
    </section>
  );
}
