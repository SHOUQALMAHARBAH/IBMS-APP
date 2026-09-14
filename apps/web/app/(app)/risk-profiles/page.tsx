'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createRiskProfile,
  getConsolidatedRiskProfiles,
  listRiskProfiles,
  type ConsolidatedSurvey,
  type RiskProfile,
} from '../../../lib/risk-profile/risk-profile-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
  inputStyle,
  labelStyle,
} from '../../../components/auth/auth-form.styles';
import { pageStyle, sectionStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import {
  siteCardStyle,
  summaryFigureLabelStyle,
  summaryFigureValueStyle,
  summaryGridStyle,
  summaryPanelStyle,
} from '../../../components/risk-profile/risk-profile.styles';
import { useLanguage } from '../../../lib/i18n/language-context';


function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={summaryFigureLabelStyle}>{label}</div>
      <div style={summaryFigureValueStyle}>{value}</div>
    </div>
  );
}

function ConsolidatedPanel({ survey }: { survey: ConsolidatedSurvey }) {
  const { t } = useLanguage();
  const c = survey.consolidated;
  return (
    <div style={summaryPanelStyle}>
      <strong>Consolidated Sum Insured ({c.siteCount} site{c.siteCount === 1 ? '' : 's'})</strong>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
        The figure a multi-site client&apos;s single Insurance Program is built
        from. Program assembly itself is Process 7.
      </p>
      <div style={summaryGridStyle}>
        <Figure label={t('rpColProperty')} value={c.propertySumInsured} />
        <Figure
          label={t('rpColBusinessInterruption')}
          value={c.businessInterruptionSumInsured}
        />
        <Figure label={t('rpColTotal')} value={c.totalSumInsured} />
        <Figure
          label={t('rpColIndemnityPeriod')}
          value={
            c.indemnityPeriodMonths == null
              ? '—'
              : `${c.indemnityPeriodMonths} months`
          }
        />
        <Figure label={t('rpColFleetVehicles')} value={String(c.fleetVehicleCount)} />
      </div>
    </div>
  );
}

function RiskProfilesForCustomer({ customerId }: { customerId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { user } = useAuth();

  const [profiles, setProfiles] = useState<RiskProfile[] | null>(null);
  const [consolidated, setConsolidated] = useState<ConsolidatedSurvey | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [siteLabel, setSiteLabel] = useState('');
  const [priorClaims, setPriorClaims] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canEdit =
    hasPermission(user, 'risk-profile.create');

  const load = useCallback(async () => {
    try {
      const [list, roll] = await Promise.all([
        listRiskProfiles(customerId),
        getConsolidatedRiskProfiles(customerId),
      ]);
      setProfiles(list);
      setConsolidated(roll);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('rpNoPermission')
          : err instanceof ApiError && err.status === 404
            ? t('rpCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('rpLoadError'),
      );
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  async function handleAddSite(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await createRiskProfile({
        customerId,
        siteLabel: siteLabel || undefined,
        priorClaimsHistorySummary: priorClaims || undefined,
      });
      setSiteLabel('');
      setPriorClaims('');
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiError
          ? err.message
          : t('rpAddSiteError'),
      );
    } finally {
      setCreating(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!profiles) return <p>{t('rpLoading')}</p>;

  return (
    <>
      {consolidated && profiles.length > 0 ? (
        <ConsolidatedPanel survey={consolidated} />
      ) : null}

      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t('rpSitesHeading')}</h2>
        {profiles.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            {t('rpNoProfileYet')}
          </p>
        ) : (
          profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              style={siteCardStyle}
              aria-label={`Open risk survey for ${profile.siteLabel ?? profile.id}`}
              onClick={() => router.push(`/risk-profiles/${profile.id}`)}
            >
              <strong>
                {profile.siteLabel ?? `Risk profile ${profile.id.slice(0, 8)}`}
              </strong>
              {profile.priorClaimsHistorySummary ? (
                <div style={{ opacity: 0.7, fontSize: '0.85rem' }}>
                  Prior claims: {profile.priorClaimsHistorySummary}
                </div>
              ) : null}
            </button>
          ))
        )}
      </section>

      {canEdit ? (
        <form onSubmit={(e) => void handleAddSite(e)} style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>{t('rpAddSiteHeading')}</h2>
          <label htmlFor="rp-site" style={labelStyle}>
            {t('rpSiteLabelField')}
          </label>
          <input
            id="rp-site"
            value={siteLabel}
            onChange={(e) => setSiteLabel(e.target.value)}
            style={inputStyle}
            placeholder={t('rpSitePlaceholder')}
          />
          <label htmlFor="rp-claims" style={labelStyle}>
            {t('rpPriorClaimsField')}
          </label>
          <input
            id="rp-claims"
            value={priorClaims}
            onChange={(e) => setPriorClaims(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={creating}
            style={{ ...buttonStyle, width: 'auto' }}
          >
            {creating ? t('rpAddingButton') : t('rpAddSiteButton')}
          </button>
          {createError ? (
            <p role="alert" style={errorStyle}>
              {createError}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}

function RiskProfilesFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        No customer selected — open a customer from{' '}
        <button
          type="button"
          onClick={() => router.push('/customers')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          Customers
        </button>{' '}
        and start the risk survey from there.
      </p>
    );
  }

  return <RiskProfilesForCustomer customerId={customerId} />;
}

export default function RiskProfilesPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('rpSurveysHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('rpSurveysIntro')}
      </p>
      <Suspense fallback={null}>
        <RiskProfilesFlow />
      </Suspense>
    </main>
  );
}
