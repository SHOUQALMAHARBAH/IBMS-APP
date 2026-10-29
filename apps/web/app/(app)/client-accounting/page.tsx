'use client';

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  AR_AGEING_BUCKET_KEYS,
  AR_AGEING_BUCKET_LABEL_KEY,
  getReceivablesAgeing,
  type ReceivablesAgeingReport,
} from '../../../lib/client-accounting/ageing-api';
import { ApiError } from '../../../lib/auth/api-client';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate, formatMoney, formatNumber } from '../../../lib/i18n/format';
import type { Language, TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/**
 * THE OLDEST OUTSTANDING INVOICE, IN THE SIBLING SCREEN'S OWN TREATMENT.
 *
 * This read `${daysOverdue}d overdue` and `due ${date}` — two English runs on the screen that says
 * what clients owe the office, on an Arabic-first product. `hardcoded-ui-english.py` reports 0 for
 * them because its template-literal pattern needs TWO words and each of these has one.
 *
 * `/sla-dashboard` renders the same concept as `${overdueDays}d` with the meaning in its column
 * heading, so the figure stays a figure and the meaning comes from `statusOverdue` — owner
 * decision 55's marker, already serving three screens, whose job is exactly to sit beside a date
 * or a figure and say the deadline has passed.
 *
 * The not-yet-due case renders the DATE ALONE: `caColOldest` («الأقدم») already says what the
 * column is, and the English `due ` prefix carried nothing on top of it. The third case keeps its
 * em dash — *nothing is outstanding* is not one of owner decision 60's three cases, and her
 * instruction with those words was that a site which does not fit one of them keeps the dash.
 */
function oldest(
  daysOverdue: number,
  dueDate: string | null,
  language: Language,
  t: (key: TranslationKey) => string,
): string {
  if (daysOverdue > 0) {
    return `${formatNumber(daysOverdue, language)}d ${t('statusOverdue')}`;
  }
  if (dueDate) return formatDate(dueDate, language);
  return '—';
}


export default function ClientAccountingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const { language } = useLanguage();

  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<ReceivablesAgeingReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (on: string) => {
    try {
      setData(await getReceivablesAgeing(on ? { asOf: on } : {}));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'caRefusalAct', 'client-accounting.read')
          : err instanceof ApiError
            ? err.message
            : t('caLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(asOf);
    })();
  }, [user, asOf, load, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('caHeading')}
        description={t('caIntro')}
      />

      <label
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}
      >
        {t('caAsOf')}
        <input
          type="date"
          aria-label={t('caAsOfDateAria')}
          value={asOf}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(ev) => setAsOf(ev.target.value)}
        />
      </label>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {data ? (
        data.rows.length === 0 ? (
          <EmptyState title={t('caNone')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('caColClient')}</Th>
                  {AR_AGEING_BUCKET_KEYS.map((k) => (
                    <Th key={k}>
                      {t(AR_AGEING_BUCKET_LABEL_KEY[k])}
                    </Th>
                  ))}
                  <Th>{t('caColOutstanding')}</Th>
                  <Th>{t('caColInvoices')}</Th>
                  <Th>{t('caColOldest')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r.customerId}>
                    <Td>
                      <bdi>{r.customerLegalName}</bdi>
                    </Td>
                    {AR_AGEING_BUCKET_KEYS.map((k) => (
                      <Td key={k}>
                        {formatMoney(r[k], language)}
                      </Td>
                    ))}
                    <Td>{formatMoney(r.outstandingTotal, language)}</Td>
                    <Td>{r.invoiceCount}</Td>
                    <Td>
                      {oldest(r.oldestDaysOverdue, r.oldestDueDate, language, t)}
                    </Td>
                  </Tr>
                ))}
                {/* THE TOTALS ROW IS A ROW, not eight bold cells. It carried
                    `{ ...cellStyle, fontWeight: 600 }` once per column — eight inline style
                    objects all saying one thing about the row they are in — and `Tr`'s `total`
                    variant says it once, with the rule and the sunken ground that tell a reader
                    this line is not one of the things in the list. */}
                <Tr variant="total">
                  <Td>{t('caColTotal')}</Td>
                  {AR_AGEING_BUCKET_KEYS.map((k) => (
                    <Td key={k} numeric>
                      {formatMoney(data.totals[k], language)}
                    </Td>
                  ))}
                  <Td numeric>
                    {formatMoney(data.totals.outstandingTotal, language)}
                  </Td>
                  <Td numeric>
                    {data.totals.invoiceCount}
                  </Td>
                  <Td />
                </Tr>
              </tbody>
            </Table>
          </div>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('caLoading')} />
      )}
    </main>
  );
}
