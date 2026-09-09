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

const STATUS_LABEL_MAP: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED_TO_PROSPECT: 'Converted',
};

const STATUS_LABEL_MAP_AR: Record<string, string> = {
  NEW: 'جديد',
  CONTACTED: 'تم التواصل',
  QUALIFIED: 'مؤهل',
  CONVERTED_TO_PROSPECT: 'تم التحويل',
};

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading2, setIsLoading2] = useState(true);

  const isArabic = language === 'AR';

  const load = useCallback(async () => {
    try {
      setIsLoading2(true);
      const response = await apiGet<LeadDetail>(`/leads/${params.id}`);
      setLead(response);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? (isArabic ? 'غير موجود' : 'Not found')
          : err instanceof ApiError
            ? err.message
            : (isArabic ? 'يرجى المحاولة مرة أخرى' : 'Please try again'),
      );
    } finally {
      setIsLoading2(false);
    }
  }, [params.id, isArabic]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    // Deferred through an async IIFE so the first `setIsLoading` inside
    // `load` does not run synchronously in the effect body — the same
    // shape every other data-loading screen here uses (see
    // `app/(app)/customers/page.tsx`).
    void (async () => {
      await load();
    })();
  }, [user, load]);

  if (isLoading || !user) return null;

  if (isLoading2) {
    return (
      <div style={pageStyle}>
        <p>{isArabic ? 'جاري التحميل...' : 'Loading...'}</p>
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
          {isArabic ? 'العودة إلى القائمة' : 'Back to List'}
        </button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={pageStyle}>
        <p>{isArabic ? 'غير موجود' : 'Not found'}</p>
      </div>
    );
  }

  const statusLabels = isArabic ? STATUS_LABEL_MAP_AR : STATUS_LABEL_MAP;
  const displayStatus = statusLabels[lead.status] || lead.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {isArabic ? 'تفاصيل العميل المرتقب' : 'Lead Details'} — <bdi>{lead.fullName}</bdi>
      </h1>

      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {isArabic ? 'المعلومات الأساسية' : 'Basic Information'}
        </h2>
        <div style={profileGridStyle}>
          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'الاسم الكامل' : 'Full Name'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.fullName}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'الحالة' : 'Status'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'المصدر' : 'Source'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.source}</bdi>
            </div>
          </div>

          {lead.contactPhone && (
            <div>
              <div style={profileFieldLabelStyle}>{isArabic ? 'الهاتف' : 'Phone'}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{lead.contactPhone}</bdi>
              </div>
            </div>
          )}

          {lead.contactEmail && (
            <div>
              <div style={profileFieldLabelStyle}>{isArabic ? 'البريد الإلكتروني' : 'Email'}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{lead.contactEmail}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'موافقة التسويق' : 'Marketing Consent'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{lead.marketingConsentGranted ? (isArabic ? 'نعم' : 'Yes') : (isArabic ? 'لا' : 'No')}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'تاريخ الإنشاء' : 'Created'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(lead.createdAt).toLocaleDateString(isArabic ? 'ar-JO' : 'en-US')}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'آخر تحديث' : 'Updated'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(lead.updatedAt).toLocaleDateString(isArabic ? 'ar-JO' : 'en-US')}</bdi>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/leads')}
      >
        {isArabic ? 'العودة' : 'Back'}
      </button>
    </div>
  );
}
