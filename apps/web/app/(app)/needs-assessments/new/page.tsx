'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  createRiskProfile,
  listRiskProfiles,
  type RiskProfile,
} from '../../../../lib/risk-profile/risk-profile-api';
import { type NeedsAssessment } from '../../../../lib/needs-assessment/needs-assessment-api';
import { NeedsAssessmentForm } from '../../../../components/needs-assessment/NeedsAssessmentForm';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
  inputStyle,
  labelStyle,
} from '../../../../components/auth/auth-form.styles';
import { pageStyle, sectionStyle } from '../../../../components/lead/lead.styles';

// Client-side hint only — the backend enforces needs-assessment.create /
// risk-profile.create on POST regardless (same convention as
// leads/page.tsx's CAN_CREATE_LEAD_ROLES).
const CAN_START_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

function NewNeedsAssessmentFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  const [profiles, setProfiles] = useState<RiskProfile[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    searchParams.get('riskProfileId') ?? '',
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [siteLabel, setSiteLabel] = useState('');
  const [priorClaims, setPriorClaims] = useState('');
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    if (!customerId) return;
    try {
      const result = await listRiskProfiles(customerId);
      setProfiles(result);
      setLoadError(null);
      // Convenience only — preselect when there's exactly one and the
      // officer hasn't chosen yet. Functional form so this callback never
      // has to depend on (and re-run for) selectedProfileId.
      if (result.length === 1) {
        setSelectedProfileId((current) => current || result[0].id);
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? 'This customer could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load risk profiles — try again.',
      );
    }
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    void (async () => {
      await loadProfiles();
    })();
  }, [customerId, loadProfiles]);

  async function handleCreateProfile(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setCreatingProfile(true);
    try {
      const created = await createRiskProfile({
        customerId,
        siteLabel: siteLabel || undefined,
        priorClaimsHistorySummary: priorClaims || undefined,
      });
      setProfiles((current) => [created, ...(current ?? [])]);
      setSelectedProfileId(created.id);
      setSiteLabel('');
      setPriorClaims('');
    } catch (err) {
      setProfileError(
        err instanceof ApiError
          ? err.message
          : 'Could not create the risk profile — try again.',
      );
    } finally {
      setCreatingProfile(false);
    }
  }

  function handleSaved(assessment: NeedsAssessment) {
    router.push(`/needs-assessments/${assessment.id}`);
  }

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        No customer selected — open a customer from{' '}
        <button
          type="button"
          onClick={() => router.push('/customers')}
          style={{ textDecoration: 'underline' }}
        >
          Customers
        </button>{' '}
        and start the assessment from there.
      </p>
    );
  }

  return (
    <>
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Risk profile</h2>
        <p style={{ opacity: 0.8 }}>
          Pick the location this assessment covers, or add one. The detailed asset survey
          and Sum Insured derivation live under{' '}
          <button
            type="button"
            onClick={() => router.push(`/risk-profiles?customerId=${customerId}`)}
            style={{ textDecoration: 'underline', cursor: 'pointer' }}
          >
            Risk surveys
          </button>
          .
        </p>

        {profiles && profiles.length > 0 ? (
          <div>
            <label htmlFor="rp-select" style={labelStyle}>
              Existing risk profile
            </label>
            <select
              id="rp-select"
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              style={inputStyle}
            >
              <option value="">— select —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.siteLabel ?? `Risk profile ${p.id.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        ) : profiles ? (
          <p style={{ opacity: 0.6 }}>No risk profile yet — add one below.</p>
        ) : (
          <p>Loading risk profiles…</p>
        )}

        <form onSubmit={(e) => void handleCreateProfile(e)} style={{ marginTop: '1rem' }}>
          <label htmlFor="rp-site" style={labelStyle}>
            New risk profile — site label (optional)
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
            disabled={creatingProfile}
            style={{ ...buttonStyle, width: 'auto' }}
          >
            {creatingProfile ? 'Adding…' : 'Add risk profile'}
          </button>
          {profileError ? (
            <p role="alert" style={errorStyle}>
              {profileError}
            </p>
          ) : null}
        </form>
      </section>

      {selectedProfileId ? (
        <NeedsAssessmentForm
          mode="create"
          riskProfileId={selectedProfileId}
          onSaved={handleSaved}
        />
      ) : (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          Select or add a risk profile to start the questionnaire.
        </p>
      )}
    </>
  );
}

export default function NewNeedsAssessmentPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const canStart = user.roles.some((role) => CAN_START_ROLES.includes(role));

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() => router.push('/needs-assessments')}
        style={{ cursor: 'pointer' }}
      >
        ← All needs assessments
      </button>
      <h1>New needs assessment</h1>
      {canStart ? (
        <Suspense fallback={null}>
          <NewNeedsAssessmentFlow />
        </Suspense>
      ) : (
        <p role="alert" style={errorStyle}>
          You don&apos;t hold the needs-assessment.create permission, so there&apos;s
          nothing to do here.
        </p>
      )}
    </main>
  );
}
