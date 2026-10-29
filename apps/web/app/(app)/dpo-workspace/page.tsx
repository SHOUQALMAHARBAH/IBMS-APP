'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getDpoWorkspaceSummary,
  type DpoWorkspaceSummary,
} from '../../../lib/pdpl/dpo-workspace-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const ROLES = ['dpo-workspace.view'];

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
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'dpowRefusalAct', 'dpo-workspace.view')
          : err instanceof ApiError
            ? err.message
            : t('dpowLoadError'),
      );
    }
  }, [t]);

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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dpowHeading')}
        description={t('dpowIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {!canView ? null : !summary ? (
        loadError ? null : (
          <SkeletonList rows={4} label={t('dpowLoading')} />
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <h2>{t('dpowConsentStatus')}</h2>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <span>
                {t('dpowConsentActive')} {summary.consentStatus.activeCount}
              </span>
              <span>
                {t('dpowConsentWithdrawn')}{' '}
                {summary.consentStatus.withdrawnCount}
              </span>
              <span>
                {t('dpowConsentDeclined')} {summary.consentStatus.declinedCount}
              </span>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowDsrQueue')}</h2>
            {summary.dsrQueue.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>
                {t('dpowNoOpenDsr')}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '48rem' }}
                >
                  <thead>
                    <tr>
                      <Th>{t('dpowColType')}</Th>
                      <Th>{t('dpowColStatus')}</Th>
                      <Th>{t('dpowColSlaDue')}</Th>
                      <Th>{t('dpowColDaysUntilDue')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dsrQueue.map((d) => (
                      <Tr key={d.id}>
                        <Td>{t(ENUM_LABEL.DsrType[d.type])}</Td>
                        <Td>
                          {t(ENUM_LABEL.DsrStatus[d.status])}
                        </Td>
                        <Td>{d.slaDueAt.slice(0, 10)}</Td>
                        <Td>
                          {d.daysUntilDue < 0
                            ? t('dpowOverdueBy', {
                                days: Math.abs(d.daysUntilDue),
                              })
                            : t('dpowDaysLeft', { days: d.daysUntilDue })}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowIncidentRegister')}</h2>
            {summary.incidentRegister.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>
                {t('dpowNoOpenIncidents')}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '40rem' }}
                >
                  <thead>
                    <tr>
                      <Th>{t('dpowColTitle')}</Th>
                      <Th>{t('dpowColSeverity')}</Th>
                      <Th>{t('dpowColStatus')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.incidentRegister.map((i) => (
                      <Tr key={i.id}>
                        <Td>{i.title}</Td>
                        <Td>
                          {t(ENUM_LABEL.IncidentSeverity[i.severity])}
                        </Td>
                        <Td>
                          {t(ENUM_LABEL.IncidentStatus[i.status])}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowDpiaRegister')}</h2>
            {summary.dpiaRegister.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>
                {t('dpowNoDpiaAwaiting')}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '40rem' }}
                >
                  <thead>
                    <tr>
                      <Th>{t('dpowColSubject')}</Th>
                      <Th>{t('dpowColOutcome')}</Th>
                      <Th>{t('dpowColReviewDue')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dpiaRegister.map((d) => (
                      <Tr key={d.id}>
                        <Td>{d.subjectDescription}</Td>
                        <Td>
                          {t(ENUM_LABEL.DpiaOutcome[d.outcome])}
                        </Td>
                        <Td>
                          {d.dpoReviewDueAt
                            ? d.dpoReviewDueAt.slice(0, 10)
                            : '—'}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowHoldRegister')}</h2>
            {summary.legalHoldRegister.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>
                {t('dpowNoHolds')}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '40rem' }}
                >
                  <thead>
                    <tr>
                      <Th>{t('dpowColScope')}</Th>
                      <Th>{t('dpowColNextReviewDue')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.legalHoldRegister.map((h) => (
                      <Tr key={h.id}>
                        <Td>{h.scope}</Td>
                        <Td>{h.nextReviewDueAt.slice(0, 10)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpowCbtRegister')}</h2>
            {summary.crossBorderTransferRegister.length === 0 ? (
              <EmptyState title={t('dpowNoCbt')} />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ borderCollapse: 'collapse', minWidth: '40rem' }}
                >
                  <thead>
                    <tr>
                      <Th>{t('dpowColDestination')}</Th>
                      <Th>{t('dpowColLegalBasis')}</Th>
                      <Th>{t('dpowColTransferredAt')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.crossBorderTransferRegister.map((t) => (
                      <Tr key={t.id}>
                        <Td>{t.destinationCountry}</Td>
                        <Td>{t.legalBasis}</Td>
                        <Td>{t.transferredAt.slice(0, 10)}</Td>
                      </Tr>
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
