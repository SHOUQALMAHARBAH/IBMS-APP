'use client';

import {
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getInsurerPayables,
  type InsurerPayablesReport,
} from '../../../lib/insurer-accounting/payables-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate, formatMoney } from '../../../lib/i18n/format';
import type { Language } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

function oldest(
  daysOutstanding: number,
  collectedAt: string | null,
  language: Language,
): string {
  if (daysOutstanding >= 0 && collectedAt)
    return `${daysOutstanding}d (since ${formatDate(collectedAt, language)})`;
  return '—';
}


export default function InsurerAccountingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const { language } = useLanguage();

  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<InsurerPayablesReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (on: string) => {
    try {
      setData(await getInsurerPayables(on ? { asOf: on } : {}));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'iaRefusalAct', 'insurer-accounting.read')
          : err instanceof ApiError
            ? err.message
            : t('iaLoadError'),
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
    <main style={pageStyle}>
      <h1>{t('iaHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '44rem' }}>
        {t('iaIntro')}
      </p>

      <label
        style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.75rem 0' }}
      >
        {t('iaAsOf')}
        <input
          type="date"
          aria-label={t('iaAsOfDateAria')}
          value={asOf}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(ev) => setAsOf(ev.target.value)}
        />
      </label>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {data ? (
        data.rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('iaNone')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('iaColInsurer')}</Th>
                  <Th>{t('iaColOutstanding')}</Th>
                  <Th>{t('iaColInvoices')}</Th>
                  <Th>{t('iaColOldest')}</Th>
                  <Th>{t('iaColRemittedToDate')}</Th>
                  <Th>{t('iaColRemittances')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r.insurerId}>
                    <Td>
                      <bdi>{r.insurerName}</bdi>
                    </Td>
                    <Td>{formatMoney(r.outstandingAmount, language)}</Td>
                    <Td>{r.outstandingCount}</Td>
                    <Td>
                      {oldest(r.oldestDaysOutstanding, r.oldestCollectedAt, language)}
                    </Td>
                    <Td>{formatMoney(r.remittedAmount, language)}</Td>
                    <Td>{r.remittedCount}</Td>
                  </Tr>
                ))}
                {/* THE TOTALS ROW IS A ROW — see the same note on `/client-accounting`. */}
                <Tr variant="total">
                  <Td>{t('iaColTotal')}</Td>
                  <Td numeric>
                    {formatMoney(data.totals.outstandingAmount, language)}
                  </Td>
                  <Td numeric>
                    {data.totals.outstandingCount}
                  </Td>
                  <Td />
                  <Td numeric>
                    {formatMoney(data.totals.remittedAmount, language)}
                  </Td>
                  <Td numeric>
                    {data.totals.remittedCount}
                  </Td>
                </Tr>
              </tbody>
            </Table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('iaLoading')}</p>
      )}
    </main>
  );
}
