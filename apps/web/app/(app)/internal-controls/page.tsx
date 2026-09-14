'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getSelfApprovalAudit,
  type InternalControlsAuditReport,
} from '../../../lib/internal-controls/internal-controls-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'end',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};
const leftCell: CSSProperties = { ...cell, textAlign: 'start' };
const leftHead: CSSProperties = { ...head, textAlign: 'start' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '0.6rem 0.9rem',
        minWidth: '7.5rem',
      }}
    >
      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

export default function InternalControlsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [report, setReport] = useState<InternalControlsAuditReport | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Deliberately does not touch `busy` — a `useEffect` below calls this
  // directly on mount, and setting state synchronously at the top of an
  // effect-invoked function trips react-hooks/set-state-in-effect. The
  // "Run audit now" button manages `busy` itself around this call instead.
  const load = useCallback(async () => {
    try {
      setReport(await getSelfApprovalAudit());
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('icNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('icRunError'),
      );
    }
  }, [t]);

  async function runAudit() {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  const violationCount = report?.violations.length ?? 0;

  return (
    <main style={pageStyle}>
      <h1>{t('icHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('icIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      <button type="button" disabled={busy} onClick={() => void runAudit()}>
        {busy ? t('icRunningButton') : t('icRunButton')}
      </button>

      {report ? (
        <>
          <section style={sectionStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <Stat label={t('icPairsScanned')} value={report.pairsScanned} />
              <Stat label={t('icColRowsChecked')} value={report.totalRowsChecked} />
              <Stat
                label={t('icColViolations')}
                value={
                  violationCount === 0 ? 'None' : String(violationCount)
                }
              />
            </div>
            <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Generated {report.generatedAt.replace('T', ' ').slice(0, 16)}.
            </p>
          </section>

          {violationCount === 0 ? (
            <section style={sectionStyle}>
              <p style={{ color: 'var(--success-ink)' }}>{t('icClean')}</p>
            </section>
          ) : null}

          {violationCount > 0 ? (
            <section style={sectionStyle}>
              <h2 style={{ color: '#b91c1c' }}>
                {t('icViolationsHeading')}
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
                  <thead>
                    <tr>
                      <th style={leftHead}>{t('icColEntity')}</th>
                      <th style={leftHead}>{t('icColPair')}</th>
                      <th style={leftHead}>{t('icColRecord')}</th>
                      <th style={leftHead}>{t('icColUser')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.violations.map((v) => (
                      <tr key={`${v.entityType}-${v.entityId}-${v.makerField}`}>
                        <td style={leftCell}>{v.entityType}</td>
                        <td style={leftCell}>{v.pairLabel}</td>
                        <td style={leftCell}>{v.entityId}</td>
                        <td style={leftCell}>{v.userId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section style={sectionStyle}>
            <h2>{t('icByPair')}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>{t('icColEntity')}</th>
                    <th style={leftHead}>{t('icColPair')}</th>
                    <th style={head}>{t('icColRowsChecked')}</th>
                    <th style={head}>{t('icColViolations')}</th>
                    <th style={leftHead}>{t('icColDbCheck')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byPair.map((p) => (
                    <tr key={`${p.entityType}-${p.pairLabel}`}>
                      <td style={leftCell}>
                        {p.entityType}
                        {p.dormant ? (
                          <span
                            title={t('icNoWriter')}
                            style={{ opacity: 0.6 }}
                          >
                            {' '}
                            (dormant)
                          </span>
                        ) : null}
                      </td>
                      <td style={leftCell}>{p.pairLabel}</td>
                      <td style={cell}>
                        {p.rowsChecked}
                        {p.truncated ? ' (truncated)' : ''}
                      </td>
                      <td style={cell}>{p.violationCount}</td>
                      <td style={leftCell}>{p.dbCheckConstraint ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('icLoading')}</p>
      )}
    </main>
  );
}
