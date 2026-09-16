'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { ApiError, apiGet } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, smallButtonStyle } from '../../../../components/lead/lead.styles';
import { profileFieldLabelStyle, profileFieldValueStyle, profileGridStyle } from '../../../../components/prospect/prospect.styles';
import type { LeadSource, LeadStatus } from '../../../../lib/lead/lead-api';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { leadStatusLabelKey } from '../../../../lib/lead/lead-status';

// Typed, not `string`: these two are printed to a person, so they go through
// ENUM_LABEL, and that lookup only compiles against the real vocabulary.
interface LeadDetail {
  id: string;
  fullName: string;
  source: LeadSource;
  status: LeadStatus;
  contactPhone?: string | null;
  contactEmail?: string | null;
  marketingConsentGranted: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading2, setIsLoading2] = useState(true);

  const load = useCallback(async () => {
    try {
      setIsLoading2(true);
      const response = await apiGet<LeadDetail>(`/leads/${params.id}`);
      setLead(response);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? (t('leaddNotFound'))
          : err instanceof ApiError
            ? err.message
            : (t('leaddPleaseTryAgain')),
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
        <p>{t('leaddLoading')}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={pageStyle}>
        <div style={errorStyle}>{loadError}</div>
        <button
          type="button"
          style={smallButtonStyle}
          onClick={() => router.push('/leads')}
        >
          {t('leaddBackToList')}
        </button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={pageStyle}>
        <p>{t('leaddNotFound2')}</p>
      </div>
    );
  }

  // One shared, enum-exact mapping (lib/lead/lead-status.ts). The two local
  // maps this replaced listed only four of the five statuses — DISQUALIFIED
  // was missing, so it rendered as the raw token in both languages.
  const statusKey = leadStatusLabelKey(lead.status);
  const displayStatus = statusKey ? t(statusKey) : lead.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {t('leaddLeadDetails')} — <bdi>{lead.fullName}</bdi>
      </h1>

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {t('leaddBasicInformation')}
        </h2>
        <div style={profileGridStyle}>
          <div>
            <div style={profileFieldLabelStyle}>{t('leaddFullName')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.fullName}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('leaddStatus')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('leaddSource')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{t(ENUM_LABEL.LeadSource[lead.source])}</bdi>
            </div>
          </div>

          {lead.contactPhone && (
            <div>
              <div style={profileFieldLabelStyle}>{t('leaddPhone')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{lead.contactPhone}</bdi>
              </div>
            </div>
          )}

          {lead.contactEmail && (
            <div>
              <div style={profileFieldLabelStyle}>{t('leaddEmail')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{lead.contactEmail}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('leaddMarketingConsent')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.marketingConsentGranted ? (t('leaddYes')) : (t('leaddNo'))}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('leaddCreated')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(lead.createdAt).toLocaleDateString(t('leaddEnUs'))}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('leaddUpdated')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(lead.updatedAt).toLocaleDateString(t('leaddEnUs2'))}</bdi>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/leads')}
      >
        {t('leaddBack')}
      </button>
    </div>
  );
}
