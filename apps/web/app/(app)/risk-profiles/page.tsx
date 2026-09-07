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
import {
  siteCardStyle,
  summaryFigureLabelStyle,
  summaryFigureValueStyle,
  summaryGridStyle,
  summaryPanelStyle,
} from '../../../components/risk-profile/risk-profile.styles';

const CAN_EDIT_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
];

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={summaryFigureLabelStyle}>{label}</div>
      <div style={summaryFigureValueStyle}>{value}</div>
    </div>
  );
}

function ConsolidatedPanel({ survey }: { survey: ConsolidatedSurvey }) {
  const c = survey.consolidated;
  return (
    <div style={summaryPanelStyle}>
      <strong>Consolidated Sum Insured ({c.siteCount} site{c.siteCount === 1 ? '' : 's'})</strong>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
        The figure a multi-site client&apos;s single Insurance Program is built
        from. Program assembly itself is Process 7.
      </p>
      <div style={summaryGridStyle}>
        <Figure label="Property (JOD)" value={c.propertySumInsured} />
        <Figure
          label="Business Interruption (JOD)"
          value={c.businessInterruptionSumInsured}
        />
        <Figure label="Total (JOD)" value={c.totalSumInsured} />
        <Figure
          label="Indemnity period"
          value={
            c.indemnityPeriodMonths == null
              ? '—'
              : `${c.indemnityPeriodMonths} months`
          }
        />
        <Figure label="Fleet vehicles" value={String(c.fleetVehicleCount)} />
      </div>
    </div>
  );
}

function RiskProfilesForCustomer({ customerId }: { customerId: string }) {
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
    user?.roles.some((role) => CAN_EDIT_ROLES.includes(role)) ?? false;

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
          ? "You don't hold the risk-profile.read permission, so there's nothing to show here."
          : err instanceof ApiError && err.status === 404
            ? 'This customer could not be found — it may not exist, or you may not have access to it.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load risk profiles — try again.',
      );
    }
  }, [customerId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

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
          : 'Could not add the site — try again.',
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
  if (!profiles) return <p>Loading…</p>;

  return (
    <>
      {consolidated && profiles.length > 0 ? (
        <ConsolidatedPanel survey={consolidated} />
      ) : null}

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Sites / locations</h2>
        {profiles.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            No risk profile yet for this customer — add the first site below.
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
          <h2 style={{ marginTop: 0 }}>Add a site / location</h2>
          <label htmlFor="rp-site" style={labelStyle}>
            Site label (optional)
          </label>
          <input
            id="rp-site"
            value={siteLabel}
            onChange={(e) => setSiteLabel(e.target.value)}
            style={inputStyle}
            placeholder="e.g. Head office, Aqaba warehouse"
          />
          <label htmlFor="rp-claims" style={labelStyle}>
            Prior claims history summary (optional)
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
            {creating ? 'Adding…' : 'Add site'}
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
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Risk surveys</h1>
      <p style={{ opacity: 0.8 }}>
        Process 6 — the detailed asset survey per location, deriving the Sum
        Insured and indemnity period, consolidated across sites for a
        multi-site client.
      </p>
      <Suspense fallback={null}>
        <RiskProfilesFlow />
      </Suspense>
    </main>
  );
}
