'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getOpportunity,
  type OpportunityStatus,
  type OpportunityWithContext,
} from '../../../../lib/opportunity/opportunity-api';
import { listRfqs, type Rfq, type RfqInsurerStatus } from '../../../../lib/rfq/rfq-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../../components/lead/lead.styles';
import {
  rfqActionsStyle,
  rfqBadgeStyle,
  rfqCardStyle,
} from '../../../../components/rfq/rfq.styles';
import { RecommendationSection } from '../../../../components/recommendation/RecommendationSection';
import { ClientDecisionSection } from '../../../../components/client-decision/ClientDecisionSection';
import { PolicySection } from '../../../../components/policy/PolicySection';
import { EndorsementSection } from '../../../../components/policy/EndorsementSection';
import { ClaimSection } from '../../../../components/policy/ClaimSection';
import { FinanceSection } from '../../../../components/policy/FinanceSection';
import { CommissionSection } from '../../../../components/policy/CommissionSection';
import { ConsentCaptureWidget } from '../../../../components/pdpl/ConsentCaptureWidget';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatDate } from '../../../../lib/i18n/format';
import type { TranslationKey } from '../../../../lib/i18n/translations';

const PLACEMENT_ROLE = 'PLACEMENT_TECHNICAL_OFFICER';
const MANAGER_ROLE = 'BRANCH_DEPARTMENT_MANAGER';
const COMPLIANCE_ROLE = 'COMPLIANCE_OFFICER';
const SALES_ROLE = 'SALES_RELATIONSHIP_OFFICER';
const POLICY_CHECK_ROLE = 'POLICY_CHECKING_OFFICER';
const CLAIMS_ROLE = 'CLAIMS_OFFICER';
const FINANCE_ROLE = 'FINANCE_COLLECTIONS_OFFICER';

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

const RFQ_INSURER_STATUS_LABEL_KEY: Record<RfqInsurerStatus, TranslationKey> = {
  SENT: 'rfqInsurerStatusSent',
  VIEWED: 'rfqInsurerStatusViewed',
  QUOTED: 'rfqInsurerStatusQuoted',
  DECLINED: 'rfqInsurerStatusDeclined',
  NO_RESPONSE: 'rfqInsurerStatusNoResponse',
};

function statusBreakdown(rfq: Rfq, t: (key: TranslationKey) => string): string {
  if (rfq.insurerSubmissions.length === 0) return t('oppRfqNoInsurersYet');
  const counts = new Map<RfqInsurerStatus, number>();
  for (const s of rfq.insurerSubmissions) {
    counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, v]) => `${v} ${t(RFQ_INSURER_STATUS_LABEL_KEY[k])}`)
    .join(' · ');
}

export default function OpportunityDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [opportunity, setOpportunity] = useState<OpportunityWithContext | null>(
    null,
  );
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const opp = await getOpportunity(params.id);
      setOpportunity(opp);
      setLoadError(null);
      try {
        setRfqs(await listRfqs({ opportunityId: opp.id }));
      } catch {
        // rfq.read may be missing even when opportunity.read is held — show
        // the header without the RFQ list rather than erroring the page.
        setRfqs([]);
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('oppDetailNotFound')
          : err instanceof ApiError
            ? err.message
            : t('oppDetailLoadError'),
      );
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  if (isLoading || !user) return null;

  const isPlacement = user.roles.includes(PLACEMENT_ROLE);
  const isManager = user.roles.includes(MANAGER_ROLE);
  const isCompliance = user.roles.includes(COMPLIANCE_ROLE);
  const isSales = user.roles.includes(SALES_ROLE);
  const isPolicyChecker = user.roles.includes(POLICY_CHECK_ROLE);
  const isClaims = user.roles.includes(CLAIMS_ROLE);
  const isFinance = user.roles.includes(FINANCE_ROLE);

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() =>
          router.push(
            opportunity
              ? `/opportunities?customerId=${opportunity.customerId}`
              : '/opportunities',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        {t('oppDetailBackButton')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {opportunity ? (
        <>
          <h1>{t('oppDetailHeading', { id: opportunity.id.slice(0, 8) })}</h1>
          <p style={{ opacity: 0.8 }}>
            {t('oppDetailStatusLine', { status: t(OPPORTUNITY_STATUS_LABEL_KEY[opportunity.status]) })}
          </p>
          {opportunity.context.insuranceProgramId ? (
            <div style={cardMetaStyle}>
              {t('oppDetailFromProgramPrefix')}{' '}
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
                onClick={() =>
                  router.push(
                    `/insurance-programs/${opportunity.context.insuranceProgramId}`,
                  )
                }
              >
                {opportunity.context.insuranceProgramId.slice(0, 8)}
              </button>
            </div>
          ) : null}

          <div style={rfqActionsStyle}>
            {isPlacement ? (
              <button
                type="button"
                style={buttonStyle}
                onClick={() =>
                  router.push(`/rfqs/new?opportunityId=${opportunity.id}`)
                }
              >
                {t('oppCreateRfqButton')}
              </button>
            ) : null}
          </div>

          <h2 style={{ marginTop: '2rem' }}>{t('oppRfqsHeading')}</h2>
          {rfqs === null ? (
            <p>{t('commonLoading')}</p>
          ) : rfqs.length === 0 ? (
            <p style={{ opacity: 0.6 }}>{t('oppRfqsNone')}</p>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              {rfqs.map((rfq) => (
                <button
                  key={rfq.id}
                  type="button"
                  style={rfqCardStyle}
                  onClick={() => router.push(`/rfqs/${rfq.id}`)}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>
                      <bdi>{rfq.insuranceLine}</bdi>
                    </strong>
                    <span style={rfqBadgeStyle}>
                      {t(
                        rfq.insurerSubmissions.length === 1 ? 'rfqInsurerCountOne' : 'rfqInsurerCountOther',
                        { count: rfq.insurerSubmissions.length },
                      )}
                    </span>
                  </div>
                  <div style={cardMetaStyle}>
                    {t('oppRfqIssuedMeta', {
                      date: formatDate(rfq.issuedAt, language),
                      breakdown: statusBreakdown(rfq, t),
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}

          <RecommendationSection
            opportunity={opportunity}
            isPlacement={isPlacement}
            isManager={isManager}
            isCompliance={isCompliance}
            onOpportunityChanged={() => void load()}
          />

          <ClientDecisionSection
            opportunity={opportunity}
            canCapture={isSales || isPlacement}
            onOpportunityChanged={() => void load()}
          />

          <PolicySection
            opportunity={opportunity}
            isPlacement={isPlacement}
            canCheck={isPolicyChecker}
            canDeliver={isSales || isPlacement}
            onOpportunityChanged={() => void load()}
          />

          <EndorsementSection
            opportunityId={opportunity.id}
            canManage={isPlacement}
            canApproveRefund={isManager}
          />

          <FinanceSection
            opportunityId={opportunity.id}
            canInvoice={isFinance}
            canCollect={isFinance}
          />

          <CommissionSection
            opportunityId={opportunity.id}
            canCalculate={isFinance}
            canApproveOverride={isManager}
          />

          <ConsentCaptureWidget
            customerId={opportunity.customerId}
            purpose="CLAIMS"
            label={t('oppClaimsConsentLabel')}
            defaultConsentTextVersion="claims-notice-v1"
          />

          <ClaimSection
            opportunityId={opportunity.id}
            canNotify={isSales || isClaims}
            canRegister={isClaims}
            canDocument={isClaims}
            canAssess={isClaims}
            canFollowUp={isClaims}
            canSettle={isClaims || isManager}
            canSecondApproveSettlement={isManager || isFinance}
            canClose={isClaims}
          />
        </>
      ) : null}
    </main>
  );
}
