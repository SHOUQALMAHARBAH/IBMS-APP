'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  createVendorDpa,
  dpoApproveDpa,
  getVendor,
  getVendorDataShareReadiness,
  listVendorDpas,
  recordVendorAnnualReview,
  revokeVendorAccess,
  setVendorRiskTier,
  signDpa,
  terminateVendor,
  RISK_TIERS,
  type DataProcessingAgreement,
  type DataShareReadiness,
  type RiskTier,
  type Vendor,
} from '../../../../lib/supporting-operations/vendor-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

export default function VendorDetailPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const params = useParams<{ id: string }>();
  const vendorId = params.id;

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [riskTier, setRiskTierValue] = useState<RiskTier>('low');
  const [readiness, setReadiness] = useState<DataShareReadiness | null>(null);
  const [dpas, setDpas] = useState<DataProcessingAgreement[] | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      const v = await getVendor(vendorId);
      setVendor(v);
      if (v.riskTier) setRiskTierValue(v.riskTier as RiskTier);
      setLoadError(null);
    } catch (err) {
      setVendor(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the vendor.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load this vendor — try again.',
      );
    }
  }, [vendorId]);

  const loadDpas = useCallback(async () => {
    try {
      setDpas(await listVendorDpas(vendorId));
    } catch {
      setDpas(null);
    }
  }, [vendorId]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
      await loadDpas();
    })();
  }, [user, load, loadDpas]);

  async function onSetRiskTier() {
    setActionError(null);
    try {
      setVendor(await setVendorRiskTier(vendorId, riskTier));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not set the risk tier.');
    }
  }

  async function onRecordAnnualReview() {
    setActionError(null);
    try {
      setVendor(await recordVendorAnnualReview(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not record the annual review.');
    }
  }

  async function onTerminate() {
    setActionError(null);
    try {
      setVendor(await terminateVendor(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not terminate this vendor.');
    }
  }

  async function onRevokeAccess() {
    setActionError(null);
    try {
      setVendor(await revokeVendorAccess(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not revoke access.');
    }
  }

  async function onCheckReadiness() {
    setActionError(null);
    try {
      setReadiness(await getVendorDataShareReadiness(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not compute readiness.');
    }
  }

  async function onCreateDpa() {
    setActionError(null);
    try {
      await createVendorDpa(vendorId);
      await loadDpas();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not create a Data Processing Agreement.');
    }
  }

  async function onSignDpa(id: string) {
    setActionError(null);
    try {
      await signDpa(id);
      await loadDpas();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not sign the agreement.');
    }
  }

  async function onDpoApprove(id: string) {
    setActionError(null);
    try {
      await dpoApproveDpa(id);
      await loadDpas();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Could not record DPO approval — you may not hold dpa.approve.",
      );
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Vendor</h1>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}

      {vendor ? (
        <>
          <section style={sectionStyle}>
            <h2>{vendor.name}</h2>
            <p>Type: {vendor.vendorType}</p>
            <p>
              Risk tier: <strong>{vendor.riskTier ?? 'unassigned'}</strong>
            </p>
            <p>
              Annual review due:{' '}
              {vendor.annualReviewDueAt
                ? vendor.annualReviewDueAt.replace('T', ' ').slice(0, 16)
                : 'not scheduled'}
            </p>
            <p>
              Termination confirmed:{' '}
              {vendor.terminationDataReturnConfirmedAt
                ? vendor.terminationDataReturnConfirmedAt.replace('T', ' ').slice(0, 16)
                : 'not terminated'}
            </p>
            <p>
              Access revoked:{' '}
              {vendor.accessRevokedAt
                ? vendor.accessRevokedAt.replace('T', ' ').slice(0, 16)
                : 'not revoked'}
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Risk tiering</h2>
            <label>
              Risk tier
              <select
                value={riskTier}
                onChange={(e) => setRiskTierValue(e.target.value as RiskTier)}
              >
                {RISK_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>{' '}
            <button type="button" onClick={onSetRiskTier}>
              Set tier
            </button>{' '}
            <button type="button" onClick={onRecordAnnualReview}>
              Record annual review completed
            </button>
          </section>

          <section style={sectionStyle}>
            <h2>Data-share readiness</h2>
            <button type="button" onClick={onCheckReadiness}>
              Check readiness
            </button>
            {readiness ? (
              <p>
                {readiness.ready ? (
                  'Ready for a data share or access grant.'
                ) : (
                  <>
                    Not ready: {readiness.reasons.join(' ')}
                  </>
                )}
              </p>
            ) : null}
          </section>

          <section style={sectionStyle}>
            <h2>Data Processing Agreements</h2>
            <button type="button" onClick={onCreateDpa}>
              Create a new DPA
            </button>
            {dpas && dpas.length > 0 ? (
              <table style={{ borderCollapse: 'collapse', minWidth: '30rem', marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th style={head}>Signed</th>
                    <th style={head}>DPO approved</th>
                    <th style={head} />
                  </tr>
                </thead>
                <tbody>
                  {dpas.map((dpa) => (
                    <tr key={dpa.id}>
                      <td style={cell}>{dpa.signedAt ? dpa.signedAt.slice(0, 10) : 'unsigned'}</td>
                      <td style={cell}>{dpa.dpoApprovedByUserId ? 'yes' : 'no'}</td>
                      <td style={cell}>
                        {!dpa.signedAt ? (
                          <button type="button" onClick={() => onSignDpa(dpa.id)}>
                            Sign
                          </button>
                        ) : null}{' '}
                        {dpa.signedAt && !dpa.dpoApprovedByUserId ? (
                          <button type="button" onClick={() => onDpoApprove(dpa.id)}>
                            DPO approve
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ opacity: 0.6 }}>No Data Processing Agreements on file.</p>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>Termination</h2>
            <button type="button" onClick={onTerminate}>
              Terminate (confirm data return/destruction)
            </button>{' '}
            <button type="button" onClick={onRevokeAccess}>
              Revoke access
            </button>
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
