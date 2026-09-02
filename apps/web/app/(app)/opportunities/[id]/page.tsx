'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getOpportunity,
  type OpportunityWithContext,
} from '../../../../lib/opportunity/opportunity-api';
import { listRfqs, type Rfq } from '../../../../lib/rfq/rfq-api';
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

const PLACEMENT_ROLE = 'PLACEMENT_TECHNICAL_OFFICER';
const MANAGER_ROLE = 'BRANCH_DEPARTMENT_MANAGER';
const COMPLIANCE_ROLE = 'COMPLIANCE_OFFICER';
const SALES_ROLE = 'SALES_RELATIONSHIP_OFFICER';
const POLICY_CHECK_ROLE = 'POLICY_CHECKING_OFFICER';
const CLAIMS_ROLE = 'CLAIMS_OFFICER';
const FINANCE_ROLE = 'FINANCE_COLLECTIONS_OFFICER';

function statusBreakdown(rfq: Rfq): string {
  if (rfq.insurerSubmissions.length === 0) return 'no insurers yet';
  const counts = new Map<string, number>();
  for (const s of rfq.insurerSubmissions) {
    counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(' · ');
}

export default function OpportunityDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

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
          ? 'This opportunity could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this opportunity — try again.',
      );
    }
  }, [params.id]);

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
        ← All opportunities
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {opportunity ? (
        <>
          <h1>Opportunity {opportunity.id.slice(0, 8)}</h1>
          <p style={{ opacity: 0.8 }}>Status: {opportunity.status}</p>
          {opportunity.context.insuranceProgramId ? (
            <div style={cardMetaStyle}>
              From insurance program{' '}
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
                Create RFQ for a line
              </button>
            ) : null}
          </div>

          <h2 style={{ marginTop: '2rem' }}>RFQs</h2>
          {rfqs === null ? (
            <p>Loading…</p>
          ) : rfqs.length === 0 ? (
            <p style={{ opacity: 0.6 }}>
              No RFQs yet. Create one per insurance line and send it to a
              shortlist of insurers.
            </p>
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
                    <strong>{rfq.insuranceLine}</strong>
                    <span style={rfqBadgeStyle}>
                      {rfq.insurerSubmissions.length} insurer
                      {rfq.insurerSubmissions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={cardMetaStyle}>
                    Issued {new Date(rfq.issuedAt).toLocaleDateString()} ·{' '}
                    {statusBreakdown(rfq)}
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
