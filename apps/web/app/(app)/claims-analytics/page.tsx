'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getLossRatioBreakdown,
  LOSS_RATIO_GROUP_BY,
  type LossRatioBreakdown,
  type LossRatioGroupBy,
} from '../../../lib/claims-analytics/analytics-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { formatMoney } from '../../../lib/i18n/format';

// Module scope has no translator, so this maps to label KEYS and the
// component resolves them — same shape as the DPIA screening questions.
const GROUP_LABEL_KEY: Record<LossRatioGroupBy, TranslationKey> = {
  customer: 'claGroupClient',
  policy: 'claGroupPolicy',
  line: 'claInsuranceLine',
};

function ratioPct(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : v;
}

const cellStyle: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'end',
};
const headCellStyle: CSSProperties = {
  ...cellStyle,
  textAlign: 'end',
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
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
          ? t('claNoPermission')
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
    <main style={pageStyle}>
      <h1>{t('claHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        {t('claIntro')}
      </p>

      <label style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}>
        {t('claGroupBy')}
        <select
          aria-label={t('claGroupBy')}
          value={groupBy}
          onChange={(ev) => setGroupBy(ev.target.value as LossRatioGroupBy)}
        >
          {LOSS_RATIO_GROUP_BY.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL_KEY[g]}
            </option>
          ))}
        </select>
      </label>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {data ? (
        data.rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>{t('claNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
              <thead>
                <tr>
                  <th style={{ ...headCellStyle, textAlign: 'start' }}>
                    {GROUP_LABEL_KEY[data.groupBy]}
                  </th>
                  <th style={headCellStyle}>{t('claLossRatio')}</th>
                  <th style={headCellStyle}>{t('claClaimsPaid')}</th>
                  <th style={headCellStyle}>{t('claWrittenPremium')}</th>
                  <th style={headCellStyle}>{t('claColClaims')}</th>
                  <th style={headCellStyle}>{t('claColPolicies')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ ...cellStyle, textAlign: 'start' }}>
                      <bdi>{r.label}</bdi>
                    </td>
                    <td style={cellStyle}>
                      {ratioPct(r.ratio)}
                      {r.ratioCapped ? ' (capped)' : ''}
                    </td>
                    <td style={cellStyle}>{formatMoney(r.periodClaims, language)}</td>
                    <td style={cellStyle}>{formatMoney(r.periodPremium, language)}</td>
                    <td style={cellStyle}>{r.claimCount}</td>
                    <td style={cellStyle}>{r.policyCount}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cellStyle, textAlign: 'start', fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {ratioPct(data.totals.ratio)}
                    {data.totals.ratioCapped ? ' (capped)' : ''}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {formatMoney(data.totals.periodClaims, language)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {formatMoney(data.totals.periodPremium, language)}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.claimCount}
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>
                    {data.totals.policyCount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('claLoading')}</p>
      )}
    </main>
  );
}
