'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { ApiError, apiGet } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, smallButtonStyle } from '../../../../components/lead/lead.styles';
import { profileFieldLabelStyle, profileFieldValueStyle, profileGridStyle } from '../../../../components/prospect/prospect.styles';

interface PolicyDetail {
  id: string;
  policyNumber: string | null;
  status: string;
  inceptionDate: string;
  customer?: {
    id: string;
    legalName: string;
  };
  recommendation?: {
    id: string;
    recommendedQuotation?: {
      premium: string;
      insurer?: { name: string };
      deductible?: string;
      commission?: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABEL_MAP: Record<string, string> = {
  PLACEMENT_REQUESTED: 'Placement Requested',
  PLACEMENT_CONFIRMED: 'Placement Confirmed',
  ISSUED: 'Issued',
  CHECKED: 'Checked',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const STATUS_LABEL_MAP_AR: Record<string, string> = {
  PLACEMENT_REQUESTED: 'طلب وضع',
  PLACEMENT_CONFIRMED: 'وضع مؤكد',
  ISSUED: 'صادر',
  CHECKED: 'تم الفحص',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
  EXPIRED: 'منتهي الصلاحية',
};

export default function PolicyDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();

  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading2, setIsLoading2] = useState(true);

  const isArabic = language === 'AR';

  const load = useCallback(async () => {
    try {
      setIsLoading2(true);
      const response = await apiGet<PolicyDetail>(`/policies/${params.id}`);
      setPolicy(response);
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
          onClick={() => router.push('/opportunities')}
        >
          {isArabic ? 'العودة إلى القائمة' : 'Back to List'}
        </button>
      </div>
    );
  }

  if (!policy) {
    return (
      <div style={pageStyle}>
        <p>{isArabic ? 'غير موجود' : 'Not found'}</p>
      </div>
    );
  }

  const statusLabels = isArabic ? STATUS_LABEL_MAP_AR : STATUS_LABEL_MAP;
  const displayStatus = statusLabels[policy.status] || policy.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {isArabic ? 'تفاصيل الوثيقة' : 'Policy Details'} {policy.policyNumber && `— ${policy.policyNumber}`}
      </h1>

      {/* Core Policy Information */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {isArabic ? 'المعلومات الأساسية' : 'Basic Information'}
        </h2>
        <div style={profileGridStyle}>
          {policy.policyNumber && (
            <div>
              <div style={profileFieldLabelStyle}>{isArabic ? 'رقم الوثيقة' : 'Policy Number'}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{policy.policyNumber}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'الحالة' : 'Status'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'تاريخ البداية' : 'Inception Date'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.inceptionDate).toLocaleDateString(isArabic ? 'ar-JO' : 'en-US')}</bdi>
            </div>
          </div>

          {policy.customer && (
            <div>
              <div style={profileFieldLabelStyle}>{isArabic ? 'العميل' : 'Customer'}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.customer.legalName}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'تاريخ الإنشاء' : 'Created'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.createdAt).toLocaleDateString(isArabic ? 'ar-JO' : 'en-US')}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{isArabic ? 'آخر تحديث' : 'Updated'}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.updatedAt).toLocaleDateString(isArabic ? 'ar-JO' : 'en-US')}</bdi>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation & Commercial Terms */}
      {policy.recommendation?.recommendedQuotation && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            {isArabic ? 'الشروط التجارية' : 'Commercial Terms'}
          </h2>
          <div style={profileGridStyle}>
            {policy.recommendation.recommendedQuotation.insurer && (
              <div>
                <div style={profileFieldLabelStyle}>{isArabic ? 'شركة التأمين' : 'Insurer'}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.insurer.name}</bdi>
                </div>
              </div>
            )}

            <div>
              <div style={profileFieldLabelStyle}>{isArabic ? 'القسط' : 'Premium'}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.recommendation.recommendedQuotation.premium}</bdi>
              </div>
            </div>

            {policy.recommendation.recommendedQuotation.deductible && (
              <div>
                <div style={profileFieldLabelStyle}>{isArabic ? 'الخصم' : 'Deductible'}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.deductible}</bdi>
                </div>
              </div>
            )}

            {policy.recommendation.recommendedQuotation.commission && (
              <div>
                <div style={profileFieldLabelStyle}>{isArabic ? 'العمولة' : 'Commission'}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.commission}</bdi>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/opportunities')}
      >
        {isArabic ? 'العودة' : 'Back'}
      </button>
    </div>
  );
}
