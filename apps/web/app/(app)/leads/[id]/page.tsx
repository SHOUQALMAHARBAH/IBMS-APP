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
  }, [params.id, t]);

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
        <p>Loading...</p>
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
          Back to Leads
        </button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={pageStyle}>
        <p>Not found</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1>Lead Details</h1>
      <div style={profileGridStyle}>
        <div>
          <div style={profileFieldLabelStyle}>Full Name</div>
          <div style={profileFieldValueStyle}>
            <bdi>{lead.fullName}</bdi>
          </div>
        </div>
        <div>
          <div style={profileFieldLabelStyle}>Status</div>
          <div style={profileFieldValueStyle}>
            <bdi>{lead.status}</bdi>
          </div>
        </div>
        <div>
          <div style={profileFieldLabelStyle}>Source</div>
          <div style={profileFieldValueStyle}>
            <bdi>{lead.source}</bdi>
          </div>
        </div>
        {lead.contactPhone && (
          <div>
            <div style={profileFieldLabelStyle}>Phone</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.contactPhone}</bdi>
            </div>
          </div>
        )}
        {lead.contactEmail && (
          <div>
            <div style={profileFieldLabelStyle}>Email</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.contactEmail}</bdi>
            </div>
          </div>
        )}
        <div>
          <div style={profileFieldLabelStyle}>Marketing Consent</div>
          <div style={profileFieldValueStyle}>
            <bdi>{lead.marketingConsentGranted ? 'Yes' : 'No'}</bdi>
          </div>
        </div>
      </div>
      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/leads')}
      >
        Back to Leads
      </button>
    </div>
  );
}
