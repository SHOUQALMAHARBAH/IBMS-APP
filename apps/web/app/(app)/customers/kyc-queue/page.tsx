'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  listKycRecords,
  type KycQueueRecord,
  type KycRecord,
} from '../../../../lib/kyc/kyc-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { KycQueue } from '../../../../components/customer/KycQueue';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import {
  permissionRefusalAnyOf,
  reducedCapability,
} from '../../../../lib/i18n/permission-refusal';

// Roles the seeded permission grid grants `kyc.approve` to — the queue is
// COMPLIANCE_OFFICER-only; the backend independently enforces this
// regardless of what this page renders.

export default function KycQueuePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [items, setItems] = useState<KycQueueRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const result = await listKycRecords();
      setItems(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusalAnyOf(t, 'kycQueueRefusalAct', [
              'kyc.capture',
              'kyc.approve',
            ])
          : err instanceof ApiError
            ? err.message
            : t('commonTryAgain'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadQueue();
    })();
  }, [user, loadQueue, t]);

  if (isLoading || !user) return null;

  const canApprove = hasPermission(user, 'kyc.approve');

  function handleItemChanged(updated: KycRecord) {
    // The decision/screening endpoints return the generic KYCRecord shape,
    // not the queue's Customer-enriched row — merge onto the existing row
    // (same lesson as leads/page.tsx's handleLeadTransitioned) rather than
    // replacing it and losing customer.legalName/customerType.
    setItems((prev) =>
      prev
        ? prev.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          )
        : prev,
    );
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('kycQueuePageHeading')}
        description={t('kycQueuePageIntro')}
      />
      {/* TWO alerts on this screen contain the phrase "work the KYC queue" — this
          reduced-capability note and the load refusal below — because the act is named in both by
          design. Each carries its own hook so a test can address the one it means: scoping the
          assertion is the fix, never loosening it to whichever happens to render first. */}
      {!canApprove ? (
        <p role="alert" style={errorStyle} data-kyc-reduced-capability="">
          {reducedCapability(
            t,
            'kycQueueApproveCanAct',
            'kycQueueApproveCannotAct',
            'kyc.approve',
          )}
        </p>
      ) : null}
      {items === null && !loadError ? <SkeletonList rows={4} label={t('commonLoading')} /> : null}
      {loadError ? (
        <ErrorState title={loadError} data-kyc-load-error="" />
      ) : null}
      {items !== null && !loadError ? (
        <KycQueue items={items} onItemChanged={handleItemChanged} />
      ) : null}
    </main>
  );
}
