'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getLossRatioBreakdown,
  LOSS_RATIO_GROUP_BY,
  type LossRatioBreakdown,
  type LossRatioGroupBy,
} from '../../../lib/claims-analytics/analytics-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { formatLossRatio, formatMoney } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

// Module scope has no translator, so this maps to label KEYS and the
// component resolves them — same shape as the DPIA screening questions.
const GROUP_LABEL_KEY: Record<LossRatioGroupBy, TranslationKey> = {
  customer: 'claGroupClient',
  policy: 'claGroupPolicy',
  line: 'claInsuranceLine',
};



export default function ClaimsAnalyticsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [groupBy, setGroupBy] = useState<LossRatioGroupBy>('line');
  const [data, setData] = useState<LossRatioBreakdown | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (g: LossRatioGroupBy) => {
    try {
      setData(await getLossRatioBreakdown({ groupBy: g }));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'claRefusalAct', 'claims-analytics.view')
          : err instanceof ApiError
            ? err.message
            : t('claLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(groupBy);
    })();
  }, [user, groupBy, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('claHeading')}
        description={t('claIntro')}
      />

      <label style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}>
        {t('claGroupBy')}
        <select
          aria-label={t('claGroupBy')}
          value={groupBy}
          onChange={(ev) => setGroupBy(ev.target.value as LossRatioGroupBy)}
        >
          {LOSS_RATIO_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {t(GROUP_LABEL_KEY[g])}
            </option>
          ))}
        </select>
      </label>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {data ? (
        data.rows.length === 0 ? (
          <EmptyState title={t('claNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>
                    {t(GROUP_LABEL_KEY[data.groupBy])}
                  </Th>
                  <Th>{t('claLossRatio')}</Th>
                  <Th>{t('claClaimsPaid')}</Th>
                  <Th>{t('claWrittenPremium')}</Th>
                  <Th>{t('claColClaims')}</Th>
                  <Th>{t('claColPolicies')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r.key}>
                    <Td>
                      <bdi>{r.label}</bdi>
                    </Td>
                    <Td>
                      {formatLossRatio(r.ratio)}
                      {/* OWNER DECISION 55 — THE MOST DANGEROUS OF THE ELEVEN. The ratio exceeded
                          `MAX_LOSS_RATIO` and was CLAMPED to fit `Decimal(7, 4)`, so the figure on
                          screen IS THE CEILING, NOT THE RATIO — and the renewal workflow depends on
                          that number. An Arabic reader was reading a clamped ratio as the true one. */}
                      {r.ratioCapped ? ` ${t('statusRatioCapped')}` : ''}
                    </Td>
                    <Td>{formatMoney(r.periodClaims, language)}</Td>
                    <Td>{formatMoney(r.periodPremium, language)}</Td>
                    <Td>{r.claimCount}</Td>
                    <Td>{r.policyCount}</Td>
                  </Tr>
                ))}
                {/* THE TOTALS ROW IS A ROW, not six bold cells. It used to carry
                    `{ ...cellStyle, fontWeight: 600 }` once per column — six inline style
                    objects saying one thing about the row they are in. */}
                <Tr variant="total">
                  <Td>
                    {t('claColTotal')}
                  </Td>
                  <Td numeric>
                    {formatLossRatio(data.totals.ratio)}
                    {data.totals.ratioCapped ? ` ${t('statusRatioCapped')}` : ''}
                  </Td>
                  <Td numeric>
                    {formatMoney(data.totals.periodClaims, language)}
                  </Td>
                  <Td numeric>
                    {formatMoney(data.totals.periodPremium, language)}
                  </Td>
                  <Td numeric>
                    {data.totals.claimCount}
                  </Td>
                  <Td numeric>
                    {data.totals.policyCount}
                  </Td>
                </Tr>
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('claLoading')} />
      )}
    </main>
  );
}
