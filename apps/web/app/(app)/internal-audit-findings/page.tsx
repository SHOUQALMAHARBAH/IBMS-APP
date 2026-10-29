'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  closeInternalAuditFinding,
  createInternalAuditFinding,
  listInternalAuditFindings,
  recordInternalAuditFindingRemediation,
  type InternalAuditFinding,
} from '../../../lib/compliance-risk/internal-audit-finding-api';
import { ApiError } from '../../../lib/auth/api-client';
import { actionErrorText } from '../../../lib/i18n/action-error';
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
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusalAnyOf } from '../../../lib/i18n/permission-refusal';

const RECORD_ROLE = [
  'internal-audit.record',
];
const CLOSE_ROLE = [
  'internal-audit.close',
];

const formStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-3)',
  maxWidth: '30rem',
};
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };


export default function InternalAuditFindingsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canRecord = hasAnyPermission(user, RECORD_ROLE);
  const canClose = hasAnyPermission(user, CLOSE_ROLE);

  const [findings, setFindings] = useState<InternalAuditFinding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [auditPeriodLabel, setAuditPeriodLabel] = useState('');
  const [finding, setFinding] = useState('');
  const [remediationDrafts, setRemediationDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setFindings(await listInternalAuditFindings());
      setLoadError(null);
    } catch (err) {
      setFindings(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusalAnyOf(t, 'iafRefusalAct', ['internal-audit.record', 'internal-audit.close'])
          : err instanceof ApiError
            ? err.message
            : t('iafLoadError'),
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
      setActionError(actionErrorText(err, t, 'iafActionError'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createInternalAuditFinding({ auditPeriodLabel, finding });
      setAuditPeriodLabel('');
      setFinding('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('iafHeading')}
        description={t('iafIntro')}
      />

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {canRecord ? (
        <form onSubmit={submit} style={formStyle}>
          <label style={labelStyle}>
            {t('iafAuditPeriodFieldLabel')}
            <input
              aria-label={t('iafAuditPeriodLabel')}
              value={auditPeriodLabel}
              onChange={(e) => setAuditPeriodLabel(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('iafFindingLabel')}
            <input
              aria-label={t('iafFindingLabel')}
              value={finding}
              onChange={(e) => setFinding(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('iafSavingButton') : t('iafRecordButton')}
          </button>
        </form>
      ) : null}

      {findings && findings.length === 0 ? (
        <EmptyState title={t('iafNone')} />
      ) : null}

      {findings && findings.length > 0 ? (
        <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('iafAuditPeriodLabel')}</Th>
                <Th>{t('iafColFinding')}</Th>
                <Th>{t('iafColRemediation')}</Th>
                <Th>{t('iafColStatus')}</Th>
                <Th>{t('iafColAction')}</Th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.auditPeriodLabel}</Td>
                  <Td>{f.finding}</Td>
                  <Td>{f.remediationAction ?? '—'}</Td>
                  <Td>{t(ENUM_LABEL.TransactionMonitoringStatus[f.status])}</Td>
                  <Td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: '16rem' }}>
                      {canRecord && f.status === 'open' ? (
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <input
                            aria-label={t('iafRemediationActionAria')}
                            placeholder={t('iafRemediationActionLabel')}
                            value={remediationDrafts[f.id] ?? ''}
                            onChange={(e) =>
                              setRemediationDrafts((d) => ({ ...d, [f.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            disabled={busy || !(remediationDrafts[f.id] ?? '').trim()}
                            onClick={() =>
                              void run(() =>
                                recordInternalAuditFindingRemediation(
                                  f.id,
                                  (remediationDrafts[f.id] ?? '').trim(),
                                ),
                              )
                            }
                          >
                            {t('iafSaveRemediationButton')}
                          </button>
                        </div>
                      ) : null}
                      {canClose && f.status === 'open' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => closeInternalAuditFinding(f.id))}
                        >
                          {t('iafCloseButton')}
                        </button>
                      ) : null}
                      {f.status === 'closed' ? '—' : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
      {/* FETCHING is `findings === null`, and nothing else.

          This was `) : loadError ? null : (<Loading/>)` hanging off the
          `findings.length > 0` ternary above, so an empty list — which
          loaded perfectly — fell through to the loading line and rendered it
          BESIDE the empty state. Her walk: «ما بتظهر شي الي، بس بكون مكتوب
          عليها جارِ التحميل». The old comment said the branch was guarded so
          an error and a Loading line never appear together; the EMPTY
          coexistence was the one nobody asked about. Three states, three
          conditions, none of them a fallback. */}
      {findings === null && loadError === null ? (
        <SkeletonList rows={4} label={t('iafLoading')} />
      ) : null}
    </main>
  );
}
