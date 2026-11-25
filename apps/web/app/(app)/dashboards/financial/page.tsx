'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getFinancialDashboard,
  type FinancialDashboardSummary,
  type ProfitabilityRow,
} from '../../../../lib/management-reporting/financial-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  Card,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { groupLabelDisplayName } from '../../../../lib/i18n/names';
import { formatMoney } from '../../../../lib/i18n/format';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import type { TranslationKey } from '../../../../lib/i18n/translations';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

/**
 * 🔴 OWNER DECISION 153 §M3 — `r.label` IS A STORED VALUE AND IT WAS RENDERED RAW.
 *
 * The api groups written policies two ways and flattens BOTH into one `label` field
 * (`finance.config.ts:1426-1427` — `label: key`, where the key is `p.insuranceLine` for
 * `byLine` and `p.customerType` for `bySegment`). So one field carries two vocabularies and
 * only the CALL SITE knows which, which is why the map is a prop rather than a lookup here.
 *
 * ⚠️ AND `byLine` HAS NO VOCABULARY TO PASS — IT IS A DEBT ON THE API, DECLARED NOT INVENTED.
 * Its label is the English insurance-line string the policy stored, and this payload sends no
 * `insuranceLineAr` beside it. Measured in message 47 §3: exactly THREE services send that
 * field (`rfq`, `policy`, `insurance-program`) and the financial dashboard is not one of them.
 * A map here would have nothing to map, and `lineDisplayName` would hand back the same English
 * while claiming a choice the screen cannot make. ⟶ `byLine` passes NO vocabulary, renders as
 * stored, and joins the `LINE_DECLARED` debt the bilingual-names gate already records.
 */
function ProfitabilityTable({
  title,
  rows,
  vocabulary,
}: {
  title: string;
  rows: ProfitabilityRow[];
  /** Omitted where the label has no known vocabulary — see the header. A key the map does not
   *  carry renders AS STORED, which is owner decision 49's rule. */
  vocabulary?: Record<string, TranslationKey>;
}) {
  // 🔴 `language` ADDED — every amount on this screen goes through `formatMoney`, which is
  // the ONE home for how money is written (owner decision 146 ruling 1-أ keeps the digits
  // Western through `format.ts`'s bare `ar` locale). These four columns printed the API's
  // raw decimal string: «120000.000» where every other figure on the page reads «JOD 120,000.000».
  const { t, language } = useLanguage();
  return (
    <section style={sectionStyle}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>{t('dashNoData')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>
                {t('dashColGroup')}
              </Th>
              <Th>
                {t('dfinColPremium')}
              </Th>
              <Th>
                {t('dfinColClaims')}
              </Th>
              <Th>
                {t('dfinColCommission')}
              </Th>
              <Th>
                {t('dfinColNetPosition')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td>
                  {/* Two vocabularies in one field, and now two mechanisms, one each.
                      `bySegment` passes a VOCABULARY (`customerType` is a fixed enum the
                      screen maps). `byLine` passes NONE and takes `labelAr`, which the api
                      sends from the line FK — contents §أ row ١١. The header above records
                      that this used to render the English string raw because the payload
                      carried no Arabic name; it does now. */}
                  <bdi>
                    {vocabulary && r.label in vocabulary
                      ? t(vocabulary[r.label])
                      : groupLabelDisplayName(r, language)}
                  </bdi>
                </Td>
                <Td>{formatMoney(r.premiumWritten, language)}</Td>
                <Td>{formatMoney(r.claimsPaid, language)}</Td>
                <Td>{formatMoney(r.commissionEarned, language)}</Td>
                <Td>{formatMoney(r.netPosition, language)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

export default function FinancialDashboardPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<FinancialDashboardSummary | null>(
    null,
  );
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
        await getFinancialDashboard({
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
          ? permissionRefusal(t, 'dfinRefusalAct', 'dashboard.financial.view')
          : err instanceof ApiError
            ? err.message
            : t('dfinLoadError'),
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
      <PageHeader
        title={t('dfinHeading')}
        description={t('dfinIntro')}
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
          label={t('dashBranchPlacingOfficerLabel')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashInsuranceLineLabel')}
          <input
            dir="auto"
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <EntitySearch
          kind="insurer"
          value={insurerId}
          onChange={setInsurerId}
          label={t('dashInsurerIdLabel')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashAsOfDateAria')}
          <input
            placeholder={t('dashDatePlaceholder')}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <button type="submit">{t('dashApplyFilters')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance kind="asOf" at={summary.asOf} />

          <Card title={t('dfinReceivables')}>
            <div style={statStyle}>
              {formatMoney(
                summary.receivables.totals.outstandingTotal,
                language,
              )}
            </div>
            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div>
                {t('commonCurrentLabel')}{' '}
                {formatMoney(summary.receivables.totals.current, language)}
              </div>
              {/*
                🔴 OWNER DECISION 153 §M2 — the four buckets were hard-coded English.
                ⛔ The keys are BORROWED, not written: `frAgeing*` ships on `/financial-report`
                for these EXACT four receivables buckets, and `finance.ts:29-42` records that
                they are the owner's own bytes and that they are NOT `dclmAgeing0To30` — the
                claims bucket starts at day ZERO, which on a receivables report is the
                `current` column one place to the left. Those two differ by one codepoint, and
                a header claiming a range its column does not hold is worse than an English one.
              */}
              <div>
                {t('frAgeing1To30')}{' '}
                {formatMoney(summary.receivables.totals.d1_30, language)}
              </div>
              <div>
                {t('frAgeing31To60')}{' '}
                {formatMoney(summary.receivables.totals.d31_60, language)}
              </div>
              <div>
                {t('frAgeing61To90')}{' '}
                {formatMoney(summary.receivables.totals.d61_90, language)}
              </div>
              <div>
                {t('frAgeing90Plus')}{' '}
                {formatMoney(summary.receivables.totals.d90_plus, language)}
              </div>
            </div>
          </Card>

          <Card title={t('dfinPayables')}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>
                  {formatMoney(
                    summary.payables.totals.outstandingAmount,
                    language,
                  )}
                </div>
                <div>
                  {t('dfinOutstandingCount', {
                    count: summary.payables.totals.outstandingCount,
                  })}
                </div>
              </div>
              <div>
                <div style={statStyle}>
                  {formatMoney(
                    summary.payables.totals.remittedAmount,
                    language,
                  )}
                </div>
                <div>
                  {t('dfinRemittedCount', {
                    count: summary.payables.totals.remittedCount,
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card title={t('dfinCommissionIncome')}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>
                  {formatMoney(summary.commission.earned, language)}
                </div>
                <div>{t('dfinEarned')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {formatMoney(summary.commission.outstanding, language)}
                </div>
                <div>{t('dfinOutstanding')}</div>
              </div>
              <div>
                <div style={statStyle}>
                  {formatMoney(summary.commission.paid, language)}
                </div>
                <div>{t('dfinPaid')}</div>
              </div>
            </div>
          </Card>

          <Card title={t('dfinProfitability')}>
            <ProfitabilityTable
              title={t('dfinByLine')}
              rows={summary.profitability.byLine}
            />
            <ProfitabilityTable
              title={t('dfinByClientSegment')}
              rows={summary.profitability.bySegment}
              vocabulary={ENUM_LABEL.CustomerType}
            />
          </Card>
        </>
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}
