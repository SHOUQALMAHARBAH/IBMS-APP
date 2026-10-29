'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  RENEWAL_NEXT_STATUSES,
  listRenewalCases,
  runRenewalSweep,
  setRenewalFlags,
  transitionRenewalCase,
  type RenewalCase,
} from '../../../lib/renewal/renewal-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
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
import { hasPermission } from '../../../lib/auth/permissions';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { WorkflowHistoryLink } from '../../../components/ui/WorkflowHistoryLink';


export default function RenewalCasesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();
  const isArabic = language === 'AR';
  const canManage = hasPermission(user, 'renewal.manage');

  const [rows, setRows] = useState<RenewalCase[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listRenewalCases());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'renRefusalAct', 'renewal.read')
          : err instanceof ApiError
            ? err.message
            : t('renCouldNotLoadRenewalCases'),
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

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('renThatActionFailedTryAgain'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function sweep() {
    setSweepMessage(null);
    await run(async () => {
      const result = await runRenewalSweep();
      setSweepMessage(
        isArabic
          ? `تم فحص ${result.scanned} وثيقة — فُتحت ${result.opened} حالة تجديد، وتم تخطي ${result.skippedAlreadyOpen}، وفشلت ${result.failed}.`
          : t('renScanSummary', {
              scanned: result.scanned,
              opened: result.opened,
              skipped: result.skippedAlreadyOpen,
              failed: result.failed,
            }),
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('renRenewalCases')}
        description={t('renARenewalCaseOpensAutomatically')}
      />

      {canManage ? (
        <>
          <button type="button" disabled={busy} onClick={() => void sweep()}>
            {t('renRunRenewalSweepNow')}
          </button>
          {sweepMessage ? (
            <p style={{ opacity: 0.75 }}>{sweepMessage}</p>
          ) : null}
        </>
      ) : null}

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('renNoRenewalCasesNothingIs')}
          </p>
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('renCustomer')}</Th>
                  <Th>{t('renPolicy')}</Th>
                  <Th>{t('renLine')}</Th>
                  <Th>{t('renExpires')}</Th>
                  <Th>{t('renStatus')}</Th>
                  <Th>
                    {t('renLossRatio')}
                  </Th>
                  <Th>
                    {t('renReMarketing')}
                  </Th>
                  <Th>{t('renAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.customerLegalName}</Td>
                    <Td>{r.policyNumber ?? '—'}</Td>
                    <Td>{r.insuranceLine}</Td>
                    <Td>{r.expiryDate?.slice(0, 10) ?? '—'}</Td>
                    <Td>{t(ENUM_LABEL.RenewalStatus[r.status])}</Td>
                    <Td>{r.lossRatio?.ratio ?? '—'}</Td>
                    <Td>
                      {r.requiresRemarketing
                        ? t('renRequired')
                        : '—'}
                    </Td>
                    <Td>
                      {/* Owner decision 41 — this case's state history, without a pasted uuid.
                          Renders nothing without `workflow-history.read`. */}
                      <div style={{ marginBottom: '0.4rem' }}>
                        <WorkflowHistoryLink
                          entityType="RenewalCase"
                          entityId={r.id}
                        />
                      </div>
                      {canManage && r.open ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 'var(--space-2)',
                            flexWrap: 'wrap',
                          }}
                        >
                          {RENEWAL_NEXT_STATUSES[r.status].map((next) => (
                            <button
                              key={next}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => transitionRenewalCase(r.id, next))
                              }
                            >
                              {t(ENUM_LABEL.RenewalStatus[next])}
                            </button>
                          ))}
                          {!r.insurerTermsWorsened ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  setRenewalFlags(r.id, {
                                    insurerTermsWorsened: true,
                                  }),
                                )
                              }
                            >
                              {t('renInsurerTermsWorsened')}
                            </button>
                          ) : null}
                          {!r.riskChangedSinceLastRenewal ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  setRenewalFlags(r.id, {
                                    riskChangedSinceLastRenewal: true,
                                  }),
                                )
                              }
                            >
                              {t('renRiskChanged')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('renLoading')} />
      )}
    </main>
  );
}
