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
import { useLanguage } from '../../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

export default function VendorDetailPage() {
  const { t } = useLanguage();
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
  }, [isLoading, user, router, t]);

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
          ? t('vendNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('vendLoadError'),
      );
    }
  }, [vendorId, t]);

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
  }, [user, load, loadDpas, t]);

  async function onSetRiskTier() {
    setActionError(null);
    try {
      setVendor(await setVendorRiskTier(vendorId, riskTier));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendTierError'));
    }
  }

  async function onRecordAnnualReview() {
    setActionError(null);
    try {
      setVendor(await recordVendorAnnualReview(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendReviewError'));
    }
  }

  async function onTerminate() {
    setActionError(null);
    try {
      setVendor(await terminateVendor(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendTerminateError'));
    }
  }

  async function onRevokeAccess() {
    setActionError(null);
    try {
      setVendor(await revokeVendorAccess(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendRevokeError'));
    }
  }

  async function onCheckReadiness() {
    setActionError(null);
    try {
      setReadiness(await getVendorDataShareReadiness(vendorId));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendReadinessError'));
    }
  }

  async function onCreateDpa() {
    setActionError(null);
    try {
      await createVendorDpa(vendorId);
      await loadDpas();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendDpaCreateError'));
    }
  }

  async function onSignDpa(id: string) {
    setActionError(null);
    try {
      await signDpa(id);
      await loadDpas();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('vendDpaSignError'));
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
          : t('vendDpaApproveError'),
      );
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('vendHeading')}</h1>

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
            <h2>
              <bdi>{vendor.name}</bdi>
            </h2>
            <p>{t('vendTypeLabel')} {vendor.vendorType}</p>
            <p>
              {t('vendRiskTierLabel')}{' '}
              <strong>{vendor.riskTier ?? t('vendUnassigned')}</strong>
            </p>
            <p>
              {t('vendAnnualReviewDue')}{' '}
              {vendor.annualReviewDueAt
                ? vendor.annualReviewDueAt.replace('T', ' ').slice(0, 16)
                : t('vendNotScheduled')}
            </p>
            <p>
              {t('vendTerminationConfirmed')}{' '}
              {vendor.terminationDataReturnConfirmedAt
                ? vendor.terminationDataReturnConfirmedAt.replace('T', ' ').slice(0, 16)
                : t('vendNotTerminated')}
            </p>
            <p>
              {t('vendAccessRevoked')}{' '}
              {vendor.accessRevokedAt
                ? vendor.accessRevokedAt.replace('T', ' ').slice(0, 16)
                : t('vendNotRevoked')}
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>{t('vendRiskTiering')}</h2>
            <label>
              {t('vendRiskTierField')}
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
              {t('vendSetTierButton')}
            </button>{' '}
            <button type="button" onClick={onRecordAnnualReview}>
              {t('vendRecordAnnualReviewButton')}
            </button>
          </section>

          <section style={sectionStyle}>
            <h2>{t('vendDataShareReadiness')}</h2>
            <button type="button" onClick={onCheckReadiness}>
              {t('vendCheckReadinessButton')}
            </button>
            {readiness ? (
              <p>
                {readiness.ready ? (
                  t('vendReady')
                ) : (
                  <>
                    Not ready: {readiness.reasons.join(' ')}
                  </>
                )}
              </p>
            ) : null}
          </section>

          <section style={sectionStyle}>
            <h2>{t('vendDpaHeading')}</h2>
            <button type="button" onClick={onCreateDpa}>
              {t('vendCreateDpaButton')}
            </button>
            {dpas && dpas.length > 0 ? (
              <table style={{ borderCollapse: 'collapse', minWidth: '30rem', marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('vendColSigned')}</th>
                    <th style={head}>{t('vendColDpoApproved')}</th>
                    <th style={head} />
                  </tr>
                </thead>
                <tbody>
                  {dpas.map((dpa) => (
                    <tr key={dpa.id}>
                      <td style={cell}>{dpa.signedAt ? dpa.signedAt.slice(0, 10) : t('vendUnsigned')}</td>
                      <td style={cell}>{dpa.dpoApprovedByUserId ? t('vendYes') : t('vendNo')}</td>
                      <td style={cell}>
                        {!dpa.signedAt ? (
                          <button type="button" onClick={() => onSignDpa(dpa.id)}>
                            {t('vendSignButton')}
                          </button>
                        ) : null}{' '}
                        {dpa.signedAt && !dpa.dpoApprovedByUserId ? (
                          <button type="button" onClick={() => onDpoApprove(dpa.id)}>
                            {t('vendDpoApproveButton')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{t('vendNoDpas')}</p>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('vendTermination')}</h2>
            <button type="button" onClick={onTerminate}>
              {t('vendTerminateButton')}
            </button>{' '}
            <button type="button" onClick={onRevokeAccess}>
              {t('vendRevokeAccessButton')}
            </button>
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('vendLoading')}</p>
      )}
    </main>
  );
}
