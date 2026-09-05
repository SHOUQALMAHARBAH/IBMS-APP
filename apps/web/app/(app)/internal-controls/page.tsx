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

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'right',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};
const leftCell: CSSProperties = { ...cell, textAlign: 'left' };
const leftHead: CSSProperties = { ...head, textAlign: 'left' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

const NO_PERMISSION =
  "You don't hold the internal-controls.audit permission, so there's nothing to show here.";

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
          ? NO_PERMISSION
          : err instanceof ApiError
            ? err.message
            : 'Could not run the audit — try again.',
      );
    }
  }, []);

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
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  if (isLoading || !user) return null;

  const violationCount = report?.violations.length ?? 0;

  return (
    <main style={pageStyle}>
      <h1>Internal controls — self-approval audit</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Every maker/checker pair in the schema (Part A.5), scanned live for a
        row where the maker and checker resolve to the same person. Each pair
        is already backed by a database constraint that should make this
        impossible — a clean run is the expected outcome, not a surprise.
        This also runs automatically every night.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      <button type="button" disabled={busy} onClick={() => void runAudit()}>
        {busy ? 'Running…' : 'Run audit now'}
      </button>

      {report ? (
        <>
          <section style={sectionStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <Stat label="Pairs scanned" value={report.pairsScanned} />
              <Stat label="Rows checked" value={report.totalRowsChecked} />
              <Stat
                label="Violations"
                value={
                  violationCount === 0 ? 'None' : String(violationCount)
                }
              />
            </div>
            <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Generated {report.generatedAt.replace('T', ' ').slice(0, 16)}.
            </p>
          </section>

          {violationCount > 0 ? (
            <section style={sectionStyle}>
              <h2 style={{ color: '#b91c1c' }}>
                Self-approval violations found
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
                  <thead>
                    <tr>
                      <th style={leftHead}>Entity</th>
                      <th style={leftHead}>Pair</th>
                      <th style={leftHead}>Record</th>
                      <th style={leftHead}>User</th>
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
            <h2>By pair</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>Entity</th>
                    <th style={leftHead}>Pair</th>
                    <th style={head}>Rows checked</th>
                    <th style={head}>Violations</th>
                    <th style={leftHead}>DB CHECK</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byPair.map((p) => (
                    <tr key={`${p.entityType}-${p.pairLabel}`}>
                      <td style={leftCell}>
                        {p.entityType}
                        {p.dormant ? (
                          <span
                            title="No application code writes to this model yet."
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
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
