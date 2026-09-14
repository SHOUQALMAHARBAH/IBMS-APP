'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getDpoWorkspaceSummary,
  type DpoWorkspaceSummary,
} from '../../../lib/pdpl/dpo-workspace-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const ROLES = [
  'dpo-workspace.view',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '2rem 0' };


export default function DpoWorkspacePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canView = hasAnyPermission(user, ROLES);

  const [summary, setSummary] = useState<DpoWorkspaceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await getDpoWorkspaceSummary());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the DPO Workspace — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('dpowHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dpowIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!canView ? null : !summary ? (
        loadError ? null : (
          <p>{t('dpowLoading')}</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <h2>{t('dpowConsentStatus')}</h2>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <span>Active: {summary.consentStatus.activeCount}</span>
              <span>Withdrawn: {summary.consentStatus.withdrawnCount}</span>
              <span>Declined: {summary.consentStatus.declinedCount}</span>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowDsrQueue')}</h2>
            {summary.dsrQueue.length === 0 ? (
              <p style={{ opacity: 0.6 }}>{t('dpowNoOpenDsr')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>{t('dpowColType')}</th>
                      <th style={head}>{t('dpowColStatus')}</th>
                      <th style={head}>{t('dpowColSlaDue')}</th>
                      <th style={head}>{t('dpowColDaysUntilDue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dsrQueue.map((d) => (
                      <tr key={d.id}>
                        <td style={cell}>{d.type}</td>
                        <td style={cell}>{d.status}</td>
                        <td style={cell}>{d.slaDueAt.slice(0, 10)}</td>
                        <td style={cell}>
                          {d.daysUntilDue < 0
                            ? `Overdue by ${Math.abs(d.daysUntilDue)}d`
                            : `${d.daysUntilDue}d`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowIncidentRegister')}</h2>
            {summary.incidentRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>{t('dpowNoOpenIncidents')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>{t('dpowColTitle')}</th>
                      <th style={head}>{t('dpowColSeverity')}</th>
                      <th style={head}>{t('dpowColStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.incidentRegister.map((i) => (
                      <tr key={i.id}>
                        <td style={cell}>{i.title}</td>
                        <td style={cell}>{i.severity}</td>
                        <td style={cell}>{i.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowDpiaRegister')}</h2>
            {summary.dpiaRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>{t('dpowNoDpiaAwaiting')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>{t('dpowColSubject')}</th>
                      <th style={head}>{t('dpowColOutcome')}</th>
                      <th style={head}>{t('dpowColReviewDue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dpiaRegister.map((d) => (
                      <tr key={d.id}>
                        <td style={cell}>{d.subjectDescription}</td>
                        <td style={cell}>{d.outcome}</td>
                        <td style={cell}>{d.dpoReviewDueAt ? d.dpoReviewDueAt.slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowHoldRegister')}</h2>
            {summary.legalHoldRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>{t('dpowNoHolds')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>{t('dpowColScope')}</th>
                      <th style={head}>{t('dpowColNextReviewDue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.legalHoldRegister.map((h) => (
                      <tr key={h.id}>
                        <td style={cell}>{h.scope}</td>
                        <td style={cell}>{h.nextReviewDueAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowCbtRegister')}</h2>
            {summary.crossBorderTransferRegister.length === 0 ? (
              <p style={{ opacity: 0.6 }}>{t('dpowNoCbt')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                  <thead>
                    <tr>
                      <th style={head}>{t('dpowColDestination')}</th>
                      <th style={head}>{t('dpowColLegalBasis')}</th>
                      <th style={head}>{t('dpowColTransferredAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.crossBorderTransferRegister.map((t) => (
                      <tr key={t.id}>
                        <td style={cell}>{t.destinationCountry}</td>
                        <td style={cell}>{t.legalBasis}</td>
                        <td style={cell}>{t.transferredAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
