'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getComplianceDashboard,
  type ComplianceDashboardSummary,
} from '../../../../lib/management-reporting/compliance-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  Card,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Tr,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, number>;
}) {
  const entries = Object.entries(rows);
  return (
    <section style={sectionStyle}>
      <h3>{title}</h3>
      <Table>
        <tbody>
          {entries.map(([key, count]) => (
            <Tr key={key}>
              <Td>{key}</Td>
              <Td numeric>{count}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

export default function ComplianceDashboardPage() {
  const { t, tPlural } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ComplianceDashboardSummary | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getComplianceDashboard({
          branchId: branchId.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'dcmpRefusalAct', 'dashboard.compliance.view')
          : err instanceof ApiError
            ? err.message
            : t('dcmpLoadError'),
      );
    }
  }, [branchId, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit "Apply filters" submit only — see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, t]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dcmpHeading')}
        description={t('dcmpIntro')}
      />

      <form
        onSubmit={applyFilters}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'flex-end',
          margin: '0.75rem 0',
        }}
      >
        <EntitySearch
          kind="branch"
          value={branchId}
          onChange={setBranchId}
          label={t('dashBranchIdLabel')}
        />
        <button type="submit">{t('dashApplyFilters')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <BreakdownTable
            title={t('dcmpKycStatus')}
            rows={summary.kyc.byStatus}
          />

          <BreakdownTable
            title={t('dcmpComplaintsByStatus')}
            rows={summary.complaints.byStatus}
          />
          <BreakdownTable
            title={t('dcmpComplaintsByCategory')}
            rows={summary.complaints.byCategory}
          />

          <Card title={t('dcmpExceptions')}>
            <div
              style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}
            >
              <div>
                <div style={statStyle}>
                  {summary.complianceExceptions.openAmlAlertsCount}
                </div>
                <div>{t('dcmpOpenAmlAlerts')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {summary.complianceExceptions.lastSelfApprovalScan
                    ?.violationCount ?? '—'}
                </div>
                {/*
                  Item 5 batch 1. THREE hardcoded English strings here, found by the provenance guard and
                  missed by every grep I wrote, because the date sits in a TEMPLATE LITERAL rather than in
                  JSX text. The parenthetical is worth keeping as it is: "no scan has run yet" is the right
                  four-states behaviour — it distinguishes a scan that found nothing from no scan at all,
                  which is precisely the distinction this batch is about. It was simply only in English.
                */}
                <div>
                  {t('dcmpSelfApprovalViolations')}
                  {summary.complianceExceptions.lastSelfApprovalScan
                    ? ` ${t('dcmpScanAsOf', {
                        at: summary.complianceExceptions.lastSelfApprovalScan.asOf.slice(
                          0,
                          10,
                        ),
                      })}`
                    : ` ${t('dcmpNoScanYet')}`}
                </div>
              </div>
            </div>
            <BreakdownTable
              title={t('dcmpAmlByPattern')}
              rows={summary.complianceExceptions.amlByPatternType}
            />
          </Card>

          <Card title={t('dcmpRegulatoryFiling')}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>
                  {summary.regulatoryFilings.submittedCount}
                </div>
                <div>{t('dcmpSubmitted')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {summary.regulatoryFilings.pendingCount}
                </div>
                <div>{t('dcmpPending')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {summary.regulatoryFilings.overdueCount}
                </div>
                <div>{t('dcmpOverdue')}</div>
              </div>
            </div>
          </Card>

          <Card title={t('dcmpOpenDsrs')}>
            <div style={statStyle}>{summary.dsr.openCount}</div>
            <BreakdownTable
              title={t('dcmpByStatus')}
              rows={summary.dsr.byStatus}
            />
          </Card>

          <Card title={t('dcmpBreachRegister')}>
            <div style={statStyle}>
              {tPlural('dcmpBreachesOpen', summary.breachRegister.openCount)}
            </div>
            <BreakdownTable
              title={t('dcmpByStatus')}
              rows={summary.breachRegister.byStatus}
            />
          </Card>

          <Card title={t('dcmpDpiaBacklog')}>
            <div style={statStyle}>
              {summary.dpiaBacklog.pendingReviewCount}
            </div>
            <BreakdownTable
              title={t('dcmpByOutcome')}
              rows={summary.dpiaBacklog.byOutcome}
            />
          </Card>
        </>
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}
