'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { ApiError } from '../../../../lib/auth/api-client';
import { getClaim, type Claim } from '../../../../lib/claim/claim-api';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { ClaimCard } from '../../../../components/claim/ClaimCard';
import { useLanguage } from '../../../../lib/i18n/language-context';

/**
 * One claim, on a route the Claims desk can actually reach.
 *
 * The claim work surface — register, document, assess, follow up, settle,
 * close — existed only inside `ClaimSection` on `/opportunities/[id]`, behind
 * an `opportunity.read` a CLAIMS_OFFICER does not hold. This page renders the
 * SAME `ClaimCard` that screen does, so the two can never drift into two
 * different claim UIs.
 *
 * What it deliberately does NOT offer is `claim.notify`: raising a new claim
 * starts from the policy it is being raised against, and a notify form with no
 * policy in hand would have to make the user find one first. Notification
 * stays where the policy already is.
 *
 * ~~Notification stays where the policy already is.~~ **THAT SENTENCE POINTS AT A SCREEN THAT DOES NOT
 * HAVE THE CONTROL.** Measured 2026-09-29 by `scripts/measurements/permission-reachability.py`: the only
 * surface offering `claim.notify` is `/opportunities/[id]`, behind an `opportunity.read` a CLAIMS_OFFICER
 * does not hold — and neither `/policies` nor `/policies/[id]` offers it either. So **a Claims Officer
 * cannot raise a claim from anywhere they can navigate to**, and the reasoning above described an
 * intention rather than a state.
 *
 * Left as a stated defect rather than fixed here, because the fix is not a line: `ClaimSection` is keyed
 * on `opportunityId` and carries the whole claim lifecycle in nine capability props, so putting
 * notification on the policy screen means either re-keying that component or extracting a notify-only
 * control — and the form collects `estimatedLoss`, a monetary figure. Both are decisions. Raised for the
 * owner with the measurement attached; do not quietly duplicate the claims UI on a second screen, which
 * is the thing the paragraph above this one exists to prevent.
 */
export default function ClaimDetailPage() {
  const router = useRouter();
  // `useParams`, not the `params` prop: in Next 16 that prop is a Promise, and
  // every other dynamic route in this app already reads the hook.
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [claim, setClaim] = useState<Claim | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClaim(await getClaim(params.id));
      setLoadError(null);
    } catch (err) {
      setClaim(null);
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? t('claimsDetailNotFound')
          : err instanceof ApiError
            ? err.message
            : t('claimsDetailLoadError'),
      );
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() => router.push('/claims')}
        style={{ cursor: 'pointer' }}
      >
        {t('claimsDetailBackButton')}
      </button>

      {claim === null && !loadError ? <p>{t('commonLoading')}</p> : null}

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {claim ? (
        <>
          <h1>
            {t('claimsDetailHeading', {
              name:
                claim.claimNumber ??
                claim.insurerClaimReference ??
                claim.id.slice(0, 8),
            })}
          </h1>
          <ClaimCard
            claim={claim}
            abilities={{
              canDiscard: hasPermission(user, 'claim.discard'),
              canRegister: hasPermission(user, 'claim.register'),
              canDocument: hasPermission(user, 'claim.document'),
              canAssess: hasPermission(user, 'claim.assess'),
              canFollowUp: hasPermission(user, 'claim.followup.manage'),
              canSettle: hasPermission(user, 'claim.settle.approve'),
              canSecondApproveSettlement: hasPermission(
                user,
                'claim.settle.second-approve',
              ),
              canClose: hasPermission(user, 'claim.close'),
            }}
            onChanged={load}
          />
        </>
      ) : null}
    </main>
  );
}
