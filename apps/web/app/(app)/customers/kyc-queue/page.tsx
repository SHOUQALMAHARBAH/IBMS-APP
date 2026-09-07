'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { listKycRecords, type KycQueueRecord, type KycRecord } from '../../../../lib/kyc/kyc-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { KycQueue } from '../../../../components/customer/KycQueue';

// Roles the seeded permission grid grants `kyc.approve` to — the queue is
// COMPLIANCE_OFFICER-only; the backend independently enforces this
// regardless of what this page renders.
const CAN_APPROVE_KYC_ROLES = ['COMPLIANCE_OFFICER'];

export default function KycQueuePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

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
          ? "You don't hold the kyc.approve/kyc.capture permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the KYC queue — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadQueue();
    })();
  }, [user, loadQueue]);

  if (isLoading || !user) return null;

  const canApprove = user.roles.some((role) => CAN_APPROVE_KYC_ROLES.includes(role));

  function handleItemChanged(updated: KycRecord) {
    // The decision/screening endpoints return the generic KYCRecord shape,
    // not the queue's Customer-enriched row — merge onto the existing row
    // (same lesson as leads/page.tsx's handleLeadTransitioned) rather than
    // replacing it and losing customer.legalName/customerType.
    setItems((prev) =>
      prev ? prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) : prev,
    );
  }

  return (
    <main style={pageStyle}>
      <h1>KYC compliance queue</h1>
      <p style={{ opacity: 0.8 }}>
        Process 3-4 — run sanctions/PEP/AML screening, route high-risk results through enhanced
        due diligence, and approve or reject each KYC file. Approving activates the Customer;
        maker/checker prevents the capturing officer from also being the approver.
      </p>
      {!canApprove ? (
        <p role="alert" style={errorStyle}>
          You don&apos;t hold the kyc.approve permission — this queue is Compliance-only.
        </p>
      ) : null}
      {items === null && !loadError ? <p>Loading…</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {items !== null && !loadError ? <KycQueue items={items} onItemChanged={handleItemChanged} /> : null}
    </main>
  );
}
