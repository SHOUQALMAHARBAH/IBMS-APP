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
  Ring,
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
import {
  formatLossRatio,
  formatMoney,
  formatNumber,
} from '../../../../lib/i18n/format';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

function LossRatioTable({
  title,
  rows,
}: {
  title: string;
  rows: LossRatioBreakdownRow[];
}) {
  const { t, language } = useLanguage();
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
                {/* Money through the money formatter — this table sat under a tile reading
                    `JOD 37,500.000` while printing `40000.000` itself. */}
                <Td numeric>{formatMoney(r.periodClaims, language)}</Td>
                <Td numeric>{formatMoney(r.periodPremium, language)}</Td>
                <Td numeric>
                  {/* `/claims-analytics` has read this as a percentage all along; this cell printed
                      the raw `0.5000`. One home now — `formatLossRatio`. */}
                  {formatLossRatio(r.ratio)}
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
  const { t, tPlural, language } = useLanguage();
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

          {/* OPEN VERSUS CLOSED IS A PROPORTION, AND IT HAS A RING NOW.
              My own note here said there was no ring because `Ring` REQUIRES a caption carrying
              the raw count and no such string shipped — the nearest, `providerOfficesUsersValue`,
              reads *{active} active of {total}* and carries the word ACTIVE, a different claim
              about a claim. The owner wrote the caption (answer 4): *{open} open claims of
              {total}*, which is `dclmOpenClaimsOfTotal` in `plurals.ts`.

              THE RULE THAT COMES WITH IT IS HERS: a ring is permitted wherever a caption of this
              shape can be written from words that ship. Where it cannot, there is still no ring
              and two tiles remain the honest answer — so the other six dashboards are NOT fitted
              with rings in this batch. One dashboard, one caption, measured.

              The count word goes through the plural machinery rather than being written beside the
              figure: Arabic has six forms and a hand-written «مطالبة» is wrong for four of them.
              The denominator is open + closed, which is what the proportion is of; `label` is
              `dclmOpenVsClosed`, already this section's own heading. */}
          <Ring
            value={summary.openClaimsCount}
            total={summary.openClaimsCount + summary.closedClaimsCount}
            percentText={`${formatNumber(
              summary.openClaimsCount + summary.closedClaimsCount > 0
                ? Math.round(
                    (summary.openClaimsCount * 100) /
                      (summary.openClaimsCount + summary.closedClaimsCount),
                  )
                : 0,
              language,
            )}%`}
            caption={tPlural(
              'dclmOpenClaimsOfTotal',
              summary.openClaimsCount,
              {
                total: formatNumber(
                  summary.openClaimsCount + summary.closedClaimsCount,
                  language,
                ),
              },
            )}
            label={t('dclmOpenVsClosed')}
            ariaLabel={tPlural(
              'dclmOpenClaimsOfTotal',
              summary.openClaimsCount,
              {
                total: formatNumber(
                  summary.openClaimsCount + summary.closedClaimsCount,
                  language,
                ),
              },
            )}
            data-testid="claims-open-ring"
          />

          {/* THE REMAINING HEADLINE FIGURES. Open and closed moved into the ring above, which is
              where a proportion belongs; what is left is a money figure, which is not one. */}
          <Tiles>
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
