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
  AR_AGEING_BUCKET_LABEL,
  getReceivablesAgeing,
  type ReceivablesAgeingReport,
} from '../../../lib/client-accounting/ageing-api';
import { ApiError } from '../../../lib/auth/api-client';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate, formatMoney } from '../../../lib/i18n/format';
import type { Language } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

function oldest(daysOverdue: number, dueDate: string | null, language: Language): string {
  if (daysOverdue > 0) return `${daysOverdue}d overdue`;
  if (dueDate) return `due ${formatDate(dueDate, language)}`;
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
                      {AR_AGEING_BUCKET_LABEL[k]}
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
                      {oldest(r.oldestDaysOverdue, r.oldestDueDate, language)}
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
