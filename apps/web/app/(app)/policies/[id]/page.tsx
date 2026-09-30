'use client';

import { useCallback, useEffect, useState } from 'react';
import { PolicyCheckingBlock } from '../../../../components/policy/PolicyCheckingBlock';
import { NotifyClaimForm } from '../../../../components/claim/NotifyClaimForm';
import { hasAnyPermission } from '../../../../lib/auth/permissions';
import type {
  Policy,
  PolicyChecking,
  PolicyStatus,
} from '../../../../lib/policy/policy-api';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { policyStatusLabelKey } from '../../../../lib/policy/policy-status';
import { ApiError, apiGet } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import {
  pageStyle,
  smallButtonStyle,
} from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
  profileGridStyle,
} from '../../../../components/prospect/prospect.styles';

/**
 * DERIVED from the API client's own `Policy`, not re-declared beside it.
 *
 * This interface used to list its fields by hand, and twice that cost the page a capability the endpoint
 * was already returning: `checking` (recorded in the comment that used to sit here) and then
 * `issuanceComplete`, which the claim-notify control needs to know whether a policy has been issued. An
 * interface that merely LACKS a field the payload carries is not a type error, so nothing fails — the
 * field simply never arrives. The comment recording the first instance did not prevent the second, which
 * is the shape this codebase keeps retiring: a note where a structure was needed.
 *
 * Deriving makes the page unable to CONTRADICT the API on any shared field, and unable to miss one. The
 * same move the insurer work made for the same reason, which is what caught the nameless-insurer case.
 *
 * `recommendation` is intersected because it is genuinely absent from `Policy` — this detail read returns
 * it and the list read does not. That is the only field this page may declare for itself.
 */
type PolicyDetail = Policy & {
  recommendation?: {
    id: string;
    recommendedQuotation?: {
      premium: string;
      insurer?: { name: string };
      deductible?: string;
      commission?: string;
    };
  };
};

export default function PolicyDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading2, setIsLoading2] = useState(true);

  const load = useCallback(async () => {
    try {
      setIsLoading2(true);
      const response = await apiGet<PolicyDetail>(`/policies/${params.id}`);
      setPolicy(response);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? t('poldNotFound')
          : err instanceof ApiError
            ? err.message
            : t('poldPleaseTryAgain'),
      );
    } finally {
      setIsLoading2(false);
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    // Deferred through an async IIFE so the first `setIsLoading` inside
    // `load` does not run synchronously in the effect body — the same
    // shape every other data-loading screen here uses (see
    // `app/(app)/customers/page.tsx`).
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  if (isLoading2) {
    return (
      <div style={pageStyle}>
        <p>{t('poldLoading')}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={pageStyle}>
        {/*
          `<p role="alert">`, not a bare `<div>`. This screen rendered its load failure in a div with no
          role, so a sighted reader saw the error and a screen-reader user was never told — the screen
          lying by omission to one class of user, and the affected reader has no way to notice. Every
          other screen in this app announces it; `test/load-error-alert.test.ts` now fails a load-error
          branch that does not.
        */}
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
        <button
          type="button"
          style={smallButtonStyle}
          onClick={() => router.push('/opportunities')}
        >
          {t('poldBackToList')}
        </button>
      </div>
    );
  }

  if (!policy) {
    return (
      <div style={pageStyle}>
        <p>{t('poldNotFound2')}</p>
      </div>
    );
  }

  // One shared, enum-exact mapping (lib/policy/policy-status.ts) rather than
  // the two local Record<string, string> maps this page used to carry. Those
  // listed PLACEMENT_REQUESTED and CHECKED — neither is a real PolicyStatus —
  // and omitted CHECKING_IN_PROGRESS, DISCREPANCY, VERIFIED and ACTIVE, so a
  // completed policy showed the literal token "ACTIVE" in both languages.
  const statusKey = policyStatusLabelKey(policy.status);
  const displayStatus = statusKey ? t(statusKey) : policy.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {t('poldPolicyDetails')}{' '}
        {policy.policyNumber && `— ${policy.policyNumber}`}
      </h1>

      {/* Core Policy Information */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {t('poldBasicInformation')}
        </h2>
        <div style={profileGridStyle}>
          {policy.policyNumber && (
            <div>
              <div style={profileFieldLabelStyle}>{t('poldPolicyNumber')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{policy.policyNumber}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('poldStatus')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('poldInceptionDate')}</div>
            <div style={profileFieldValueStyle}>
              {/*
                `inceptionDate` is NULLABLE on the API and this page rendered it as though it were not —
                found by deriving `PolicyDetail` from `Policy` rather than re-declaring it. A policy that
                is PLACED but not yet ISSUED has none, and `new Date(null)` formats as "Invalid Date",
                which tells the reader the system is broken rather than that the date is not set yet.
              */}
              <bdi>
                {policy.inceptionDate
                  ? new Date(policy.inceptionDate).toLocaleDateString(
                      t('poldEnUs'),
                    )
                  : t('poldInceptionNotSet')}
              </bdi>
            </div>
          </div>

          {policy.customer && (
            <div>
              <div style={profileFieldLabelStyle}>{t('poldCustomer')}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.customer.legalName}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('poldCreated')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>
                {new Date(policy.createdAt).toLocaleDateString(t('poldEnUs2'))}
              </bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('poldUpdated')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>
                {new Date(policy.updatedAt).toLocaleDateString(t('poldEnUs3'))}
              </bdi>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation & Commercial Terms */}
      {policy.recommendation?.recommendedQuotation && (
        <div style={{ marginBottom: '2rem' }}>
          <h2
            style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}
          >
            {t('poldCommercialTerms')}
          </h2>
          <div style={profileGridStyle}>
            {policy.recommendation.recommendedQuotation.insurer && (
              <div>
                <div style={profileFieldLabelStyle}>{t('poldInsurer')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>
                    {policy.recommendation.recommendedQuotation.insurer.name}
                  </bdi>
                </div>
              </div>
            )}

            <div>
              <div style={profileFieldLabelStyle}>{t('poldPremium')}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.recommendation.recommendedQuotation.premium}</bdi>
              </div>
            </div>

            {policy.recommendation.recommendedQuotation.deductible && (
              <div>
                <div style={profileFieldLabelStyle}>{t('poldDeductible')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>
                    {policy.recommendation.recommendedQuotation.deductible}
                  </bdi>
                </div>
              </div>
            )}

            {policy.recommendation.recommendedQuotation.commission && (
              <div>
                <div style={profileFieldLabelStyle}>{t('poldCommission')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>
                    {policy.recommendation.recommendedQuotation.commission}
                  </bdi>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Process 20. This is the screen a Policy Checking Officer can
          actually reach: their three permissions do not include
          `opportunity.read`, so the copy of this block on /opportunities/[id]
          was unreachable for the one role whose job it is. */}
      <PolicyCheckingBlock
        policy={policy}
        canCheck={hasAnyPermission(user, ['policy.check'])}
        onChecked={load}
      />

      {/*
        IMPROVEMENTS § 1.84 — the same argument as the block above, for a different role, and this page is
        now the third instance of it. `claim.notify` is held by SALES_RELATIONSHIP_OFFICER and
        CLAIMS_OFFICER; Sales holds `opportunity.read` and works in the pipeline, Claims does not and works
        from the policy. The only surface offering the notify form was `/opportunities/[id]`, so a Claims
        Officer could not raise a claim from anywhere they could navigate to.

        ONE implementation, two mount points — `ClaimSection` on the opportunity consumes the same
        component. Not a second place claim notification is written.
      */}
      <NotifyClaimForm
        policy={policy}
        canNotify={hasAnyPermission(user, ['claim.notify'])}
        onDone={load}
      />

      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/policies')}
      >
        {t('poldBack')}
      </button>
    </div>
  );
}
