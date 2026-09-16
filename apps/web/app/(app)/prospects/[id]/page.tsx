'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { getProspect, type Prospect } from '../../../../lib/prospect/prospect-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
  profileGridStyle,
} from '../../../../components/prospect/prospect.styles';

function ProfileField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div style={profileFieldLabelStyle}>{label}</div>
      <div style={profileFieldValueStyle}>
        <bdi>{value ?? '—'}</bdi>
      </div>
    </div>
  );
}

export default function ProspectProfilePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProspect = useCallback(async () => {
    try {
      const result = await getProspect(params.id);
      setProspect(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('prosdNotFound')
          : err instanceof ApiError
            ? err.message
            : t('prosdLoadError'),
      );
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadProspect();
    })();
  }, [user, loadProspect, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <button type="button" onClick={() => router.push('/prospects')} style={{ cursor: 'pointer' }}>
        {t('prospdBackToList')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {prospect ? (
        <>
          <h1>
            <bdi>{prospect.companyName}</bdi>
          </h1>
          <p style={{ opacity: 0.8 }}>Status: {prospect.status}</p>
          <div style={profileGridStyle}>
            <ProfileField label={t('prosdColSector')} value={prospect.sector} />
            <ProfileField label={t('prosdColActivity')} value={prospect.activity} />
            <ProfileField label={t('prosdColEmployeeCount')} value={prospect.employeeCount} />
            <ProfileField label={t('prosdColBusinessSize')} value={prospect.businessSize} />
            <ProfileField label={t('prosdColLocation')} value={prospect.location} />
            <ProfileField label={t('prosdColContactPerson')} value={prospect.contactPerson} />
            <ProfileField
              label={t('prosdColProductsOfInterest')}
              value={prospect.productsOfInterest.length > 0 ? prospect.productsOfInterest.join(', ') : null}
            />
            <ProfileField
              label={t('prosdColExpectedPremium')}
              value={prospect.expectedPremium ?? null}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}
