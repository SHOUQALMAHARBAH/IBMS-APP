'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { getProspect, type Prospect } from '../../../../lib/prospect/prospect-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
  profileGridStyle,
} from '../../../../components/prospect/prospect.styles';

function ProfileField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div style={profileFieldLabelStyle}>{label}</div>
      <div style={profileFieldValueStyle}>{value ?? '—'}</div>
    </div>
  );
}

export default function ProspectProfilePage() {
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
          ? 'This prospect could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this prospect — try again.',
      );
    }
  }, [params.id]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadProspect();
    })();
  }, [user, loadProspect]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <button type="button" onClick={() => router.push('/prospects')} style={{ cursor: 'pointer' }}>
        ← All prospects
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {prospect ? (
        <>
          <h1>{prospect.companyName}</h1>
          <p style={{ opacity: 0.8 }}>Status: {prospect.status}</p>
          <div style={profileGridStyle}>
            <ProfileField label="Sector" value={prospect.sector} />
            <ProfileField label="Activity" value={prospect.activity} />
            <ProfileField label="Employee count" value={prospect.employeeCount} />
            <ProfileField label="Business size" value={prospect.businessSize} />
            <ProfileField label="Location" value={prospect.location} />
            <ProfileField label="Contact person" value={prospect.contactPerson} />
            <ProfileField
              label="Products of interest"
              value={prospect.productsOfInterest.length > 0 ? prospect.productsOfInterest.join(', ') : null}
            />
            <ProfileField
              label="Expected premium (JOD)"
              value={prospect.expectedPremium ?? null}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}
