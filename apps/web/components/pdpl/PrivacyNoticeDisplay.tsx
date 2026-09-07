'use client';

import { useCallback, useEffect, useState } from 'react';
import { currentPrivacyNotice, type PrivacyNotice } from '../../lib/pdpl/privacy-notice-api';
import { ApiError } from '../../lib/auth/api-client';

// Notices (backlog Part D §5.1) — "bilingual, version-controlled text
// displayed at every touchpoint." Mounted alongside ConsentCaptureWidget at
// the same 5 touchpoints Consent already reaches (onboarding/KYC, needs &
// risk assessment, RFQ/market placement, cross-sell, up-sell) plus lead
// capture. Claims and Group Medical/Life & Motor Fleet remain the SAME
// documented gap Consent already has — no web UI/CRUD exists for either
// yet, so there is nowhere for a display widget to mount.
const NOTICE_READ_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'DATA_PROTECTION_OFFICER',
  'COMPLIANCE_OFFICER',
];

interface Props {
  touchpoint: string;
  canRead: boolean;
}

export function PrivacyNoticeDisplay({ touchpoint, canRead }: Props) {
  const [notice, setNotice] = useState<PrivacyNotice | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotice(await currentPrivacyNotice(touchpoint));
      setError(null);
    } catch (err) {
      setNotice(null);
      setError(
        err instanceof ApiError ? err.message : 'Could not load the privacy notice.',
      );
    }
  }, [touchpoint]);

  useEffect(() => {
    if (!canRead) return;
    void (async () => {
      await load();
    })();
  }, [canRead, load]);

  if (!canRead) return null;

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '0.75rem 1rem',
        margin: '0.75rem 0',
        fontSize: '0.85rem',
      }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>Privacy notice</h3>
      {error ? (
        <p role="alert" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      ) : notice === undefined ? (
        <p style={{ opacity: 0.6 }}>Loading…</p>
      ) : notice === null ? (
        <p style={{ opacity: 0.6 }}>No privacy notice published for this touchpoint yet.</p>
      ) : (
        <details>
          <summary>
            v{notice.versionNumber} — published {notice.publishedAt.slice(0, 10)}
          </summary>
          <p style={{ marginTop: '0.5rem' }}>{notice.textEn}</p>
          <p dir="rtl" style={{ marginTop: '0.5rem' }}>
            {notice.textAr}
          </p>
        </details>
      )}
    </section>
  );
}

export { NOTICE_READ_ROLES };
