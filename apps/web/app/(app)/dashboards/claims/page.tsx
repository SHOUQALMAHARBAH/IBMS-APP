'use client';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Icon,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  TextInput,
  Th,
  Tile,
  Tiles,
  Tr,
  BarList,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useCallback, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getClaimsDashboard,
  type ClaimsDashboardSummary,
  type LossRatioBreakdownRow,
} from '../../../../lib/management-reporting/claims-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatMoney, formatNumber } from '../../../../lib/i18n/format';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

function LossRatioTable({
  title,
  rows,
}: {
  title: string;
  rows: LossRatioBreakdownRow[];
}) {
  const { t } = useLanguage();
  return (
    <section>
      <h3 style={{ marginBottom: 'var(--space-2)' }}>{title}</h3>
      {rows.length === 0 ? (
        <EmptyState title={t('dashNoData')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('dashColGroup')}</Th>
              <Th numeric>{t('dclmColClaims')}</Th>
              <Th numeric>{t('dclmColPremium')}</Th>
              <Th numeric>{t('dclmColRatio')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td>
                  <bdi>{r.label}</bdi>
                </Td>
                <Td numeric>{r.periodClaims}</Td>
                <Td numeric>{r.periodPremium}</Td>
                <Td numeric>
                  {r.ratio}
                  {/* Owner decision 55 — the displayed ratio is the CEILING, not the ratio. See
                      `statusRatioCapped`. */}
                  {r.ratioCapped ? ` ${t('statusRatioCapped')}` : ''}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

export default function ClaimsDashboardPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ClaimsDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [insurerId, setInsurerId] = useState('');
  const [asOf, setAsOf] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getClaimsDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          insurerId: insurerId.trim() || undefined,
          asOf: asOf.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'dclmRefusalAct', 'dashboard.claims.view')
          : err instanceof ApiError
            ? err.message
            : t('dclmLoadError'),
      );
    }
  }, [branchId, insuranceLine, insurerId, asOf, t]);

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
      <PageHeader title={t('dclmHeading')} description={t('dclmIntro')} />

      {/* THE FILTERS ARE A CONTROL SURFACE and sit in their own card, so a reader can see where
          what they type ends and what they read begins. Two `aria-label`s were withdrawn here:
          they duplicated the visible labels beside them, which is one more string to drift and
          buys nothing — an `aria-label` REPLACES the accessible name, so the two readers were
          being told the same thing twice from two sources. */}
      <Card padded={false}>
        <form onSubmit={applyFilters}>
          <FilterBar
            actions={
              <Button type="submit">
                <Icon name="search" size={14} />
                {t('dashApplyFilters')}
              </Button>
            }
          >
            <EntitySearch
              kind="branch"
              value={branchId}
              onChange={setBranchId}
              label={t('dashBranchIdLabel')}
            />
            <Field label={t('dashInsuranceLineLabel')}>
              {(props) => (
                <TextInput
                  {...props}
                  dir="auto"
                  value={insuranceLine}
                  onChange={(e) => setInsuranceLine(e.target.value)}
                />
              )}
            </Field>
            <EntitySearch
              kind="insurer"
              value={insurerId}
              onChange={setInsurerId}
              label={t('dashInsurerIdLabel')}
            />
            <Field label={t('dashAsOf')}>
              {(props) => (
                <TextInput
                  {...props}
                  placeholder={t('dashDatePlaceholder')}
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                />
              )}
            </Field>
          </FilterBar>
        </form>
      </Card>

      {loadError ? <ErrorState title={loadError} /> : null}

      {summary ? (
        <>
          <ReportProvenance kind="asOf" at={summary.asOf} />

          {/* THE THREE HEADLINE FIGURES, in one row rather than three stacked sections.
              Each is the same figure from the same field as before — §7's limit is ordering and
              grouping, and nothing about what is DISPLAYED has changed. What changed is that a
              figure now has the weight of a figure instead of being slightly larger text.

              NO `Ring` FOR OPEN-VERSUS-CLOSED, and that is a measurement rather than a
              preference: it is a proportion and the component exists for one, but `Ring`
              REQUIRES a caption carrying the raw count, and no such string ships. The nearest,
              `providerOfficesUsersValue`, reads *{active} active of {total}* and carries the
              word ACTIVE — a different claim about a claim. Writing one is the owner's. */}
          <Tiles>
            <Tile
              icon="file"
              value={formatNumber(summary.openClaimsCount, language)}
              label={t('dclmOpen')}
            />
            <Tile
              icon="check"
              value={formatNumber(summary.closedClaimsCount, language)}
              label={t('dclmClosed')}
            />
            <Tile
              icon="coins"
              value={formatMoney(summary.outstandingClaimsValueJod, language)}
              label={t('dclmOutstandingValue')}
            />
          </Tiles>

          {/* THE AGEING IS ONE DISTRIBUTION, so it reads as one. Four numbers side by side
              do not say which is the big one, and on a claims desk *which bucket holds the
              money* is the whole question. The bar is a second carrier: every row still prints
              its count and its value, so a reader who cannot compare the bars reads exactly what
              they read before. Same four fields, same formatting. */}
          <Card title={t('dclmAgeing')}>
            <BarList
              rows={[
                {
                  name: t('dclmAgeing0To30'),
                  value: summary.ageing.d0_30.count,
                  valueText: `${formatNumber(summary.ageing.d0_30.count, language)} · ${formatMoney(summary.ageing.d0_30.valueJod, language)}`,
                },
                {
                  name: t('dclmAgeing31To60'),
                  value: summary.ageing.d31_60.count,
                  valueText: `${formatNumber(summary.ageing.d31_60.count, language)} · ${formatMoney(summary.ageing.d31_60.valueJod, language)}`,
                },
                {
                  name: t('dclmAgeing61To90'),
                  value: summary.ageing.d61_90.count,
                  valueText: `${formatNumber(summary.ageing.d61_90.count, language)} · ${formatMoney(summary.ageing.d61_90.valueJod, language)}`,
                },
                {
                  name: t('dclmAgeing90Plus'),
                  value: summary.ageing.d90_plus.count,
                  valueText: `${formatNumber(summary.ageing.d90_plus.count, language)} · ${formatMoney(summary.ageing.d90_plus.valueJod, language)}`,
                },
              ]}
            />
          </Card>

          {/* THREE CUTS OF ONE THING, in one card — by client, by line, by insurer. Three
              separate sections read as three screens. */}
          <Card title={t('dclmLossRatio')} style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <LossRatioTable
              title={t('dclmByClient')}
              rows={summary.lossRatioByClient}
            />
            <LossRatioTable
              title={t('dclmByLine')}
              rows={summary.lossRatioByLine}
            />
            <LossRatioTable
              title={t('dclmByInsurer')}
              rows={summary.lossRatioByInsurer}
            />
          </Card>
        </>
      ) : loadError ? null : (
        <SkeletonList rows={3} label={t('dashLoading')} />
      )}
    </main>
  );
}
