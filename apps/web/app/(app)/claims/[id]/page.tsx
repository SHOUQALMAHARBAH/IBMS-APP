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
