'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { ApiError, apiGet } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, smallButtonStyle } from '../../../../components/lead/lead.styles';
import { profileFieldLabelStyle, profileFieldValueStyle, profileGridStyle } from '../../../../components/prospect/prospect.styles';

interface LeadDetail {
  id: string;
  fullName: string;
  source: string;
  status: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  marketingConsentGranted: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_KEY_MAP: Record<string, string> = {
  NEW: 'leadStatusNew',
  CONTACTED: 'leadStatusContacted',
  QUALIFIED: 'leadStatusQualified',
  CONVERTED_TO_PROSPECT: 'leadStatusConvertedToProspect',
};

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
          ? 'Not found'
          : err instanceof ApiError
            ? err.message
            : 'Please try again',
      );
    } finally {
      setIsLoading2(false);
    }
  }, [params.id]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  if (isLoading || !user) return null;

  if (isLoading2) {
    return (
      <div style={pageStyle}>
        <p>{t('commonLoading')}</p>
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
          {t('commonBack')}
        </button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={pageStyle}>
        <p>{t('commonNotFound')}</p>
      </div>
    );
  }

  const statusKey = STATUS_KEY_MAP[lead.status] || lead.status;
  const displayStatus = statusKey.startsWith('lead') ? t(statusKey as any) : lead.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {t('leadsHeading')} — <bdi>{lead.fullName}</bdi>
      </h1>

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {t('commonDetails')}
        </h2>
        <div style={profileGridStyle}>
          <div>
            <div style={profileFieldLabelStyle}>{t('commonFullName')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.fullName}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('commonStatus')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('leadsSourceLabel')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.source}</bdi>
            </div>
          </div>

          {lead.contactPhone && (
            <div>
              <div style={profileFieldLabelStyle}>{t('commonPhone')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{lead.contactPhone}</bdi>
              </div>
            </div>
          )}

          {lead.contactEmail && (
            <div>
              <div style={profileFieldLabelStyle}>{t('commonEmail')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{lead.contactEmail}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('leadsMarketingConsent')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.marketingConsentGranted ? t('commonYes') : t('commonNo')}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('commonCreatedAt')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(lead.createdAt).toLocaleDateString()}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('commonUpdatedAt')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(lead.updatedAt).toLocaleDateString()}</bdi>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/leads')}
      >
        {t('commonBack')}
      </button>
    </div>
  );
}
