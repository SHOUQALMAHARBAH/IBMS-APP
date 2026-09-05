'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  formatSlaDuration,
  getSlaDashboardSummary,
  getSlaDashboardTimers,
  slaStateFilterLabel,
  slaStateLabel,
  SLA_TIMER_STATE_FILTERS,
  type SlaDashboardSummary,
  type SlaTimerRow,
  type SlaTimerStateFilter,
} from '../../../lib/sla/sla-dashboard-api';
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
  "You don't hold the sla-dashboard.view permission, so there's nothing to show here.";

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

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export default function SlaDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<SlaDashboardSummary | null>(null);
  const [timers, setTimers] = useState<SlaTimerRow[] | null>(null);
  const [stateFilter, setStateFilter] = useState<SlaTimerStateFilter>('open');
  const [loadError, setLoadError] = useState<string | null>(null);

  const messageFor = (err: unknown, fallback: string) =>
    err instanceof ApiError && err.status === 403
      ? NO_PERMISSION
      : err instanceof ApiError
        ? err.message
        : fallback;

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getSlaDashboardSummary());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(messageFor(err, 'Could not load the SLA dashboard — try again.'));
    }
  }, []);

  const loadTimers = useCallback(async (state: SlaTimerStateFilter) => {
    try {
      setTimers(await getSlaDashboardTimers({ state }));
    } catch (err) {
      setTimers(null);
      setLoadError((prev) =>
        prev ?? messageFor(err, 'Could not load the timer list — try again.'),
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void loadSummary();
  }, [user, loadSummary]);
  useEffect(() => {
    if (!user) return;
    void loadTimers(stateFilter);
  }, [user, stateFilter, loadTimers]);

  if (isLoading || !user) return null;

  const t = summary?.totals;

  return (
    <main style={pageStyle}>
      <h1>SLA dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Every module&rsquo;s SLA timers in one view — what is on track, due soon,
        breached or escalated, and how each workflow is performing against its
        configured turnaround. Live, computed on read.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!summary ? (
        loadError ? null : (
          <p>Loading&hellip;</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}
            >
              <Stat label="Timers" value={t!.total} />
              <Stat label="On track" value={t!.onTrack} />
              <Stat label="Due soon" value={t!.dueSoon} />
              <Stat label="Breached" value={t!.breached} />
              <Stat label="Escalated" value={t!.escalated} />
              <Stat
                label="Resolved"
                value={t!.resolvedOnTime + t!.resolvedLate}
              />
              <Stat
                label="Breach rate"
                value={`${(Number(t!.breachRate) * 100).toFixed(1)}%`}
              />
            </div>
            <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: '0.5rem' }}>
              &ldquo;Due soon&rdquo; = unresolved and due within{' '}
              {formatSlaDuration(summary.dueSoonWindow)}. Breach rate =
              late-or-breached over all timers that have reached a deadline.
              Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)}.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>By workflow</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>Workflow</th>
                    <th style={leftHead}>Entity</th>
                    <th style={head}>SLA</th>
                    <th style={head}>On track</th>
                    <th style={head}>Due soon</th>
                    <th style={head}>Breached</th>
                    <th style={head}>Escalated</th>
                    <th style={head}>Resolved</th>
                    <th style={head}>Oldest overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byWorkflow.length === 0 ? (
                    <tr>
                      <td style={leftCell} colSpan={9}>
                        No SLA timers yet.
                      </td>
                    </tr>
                  ) : (
                    summary.byWorkflow.map((w) => (
                      <tr key={w.workflowName}>
                        <td style={leftCell}>
                          {w.label}
                          {w.drafted ? (
                            <span
                              title="The configured SLA figure is a drafted / unsourced default."
                              style={{ opacity: 0.6 }}
                            >
                              {' '}
                              (drafted)
                            </span>
                          ) : null}
                        </td>
                        <td style={leftCell}>{w.entityType}</td>
                        <td style={cell}>
                          {formatSlaDuration(w.configuredDuration)}
                        </td>
                        <td style={cell}>{w.onTrack}</td>
                        <td style={cell}>{w.dueSoon}</td>
                        <td style={cell}>{w.breached}</td>
                        <td style={cell}>{w.escalated}</td>
                        <td style={cell}>
                          {w.resolvedOnTime + w.resolvedLate}
                        </td>
                        <td style={cell}>
                          {w.oldestOverdueDays == null
                            ? '—'
                            : `${w.oldestOverdueDays}d`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>By entity type</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>Entity type</th>
                    <th style={head}>Timers</th>
                    <th style={head}>Entities</th>
                    <th style={head}>Breached</th>
                    <th style={head}>Escalated</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byEntityType.map((e) => (
                    <tr key={e.entityType}>
                      <td style={leftCell}>{e.entityType}</td>
                      <td style={cell}>{e.total}</td>
                      <td style={cell}>{e.entityCount}</td>
                      <td style={cell}>{e.breached}</td>
                      <td style={cell}>{e.escalated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Timers</h2>
            <label
              style={{
                display: 'inline-flex',
                gap: '0.5rem',
                margin: '0.5rem 0',
              }}
            >
              Show
              <select
                aria-label="Timer state filter"
                value={stateFilter}
                onChange={(ev) =>
                  setStateFilter(ev.target.value as SlaTimerStateFilter)
                }
              >
                {SLA_TIMER_STATE_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {slaStateFilterLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>Workflow</th>
                    <th style={leftHead}>Entity</th>
                    <th style={leftHead}>State</th>
                    <th style={head}>Due</th>
                    <th style={head}>Overdue</th>
                    <th style={leftHead}>Escalates to</th>
                  </tr>
                </thead>
                <tbody>
                  {timers == null ? (
                    <tr>
                      <td style={leftCell} colSpan={6}>
                        Loading&hellip;
                      </td>
                    </tr>
                  ) : timers.length === 0 ? (
                    <tr>
                      <td style={leftCell} colSpan={6}>
                        No timers in this state.
                      </td>
                    </tr>
                  ) : (
                    timers.map((r) => (
                      <tr key={r.id}>
                        <td style={leftCell}>{r.label}</td>
                        <td style={leftCell}>
                          {r.entityType}
                          <span style={{ opacity: 0.7 }}> · {r.entityId}</span>
                        </td>
                        <td style={leftCell}>{slaStateLabel(r.state)}</td>
                        <td style={cell}>{fmtDate(r.dueAt)}</td>
                        <td style={cell}>
                          {r.overdueDays == null ? '—' : `${r.overdueDays}d`}
                        </td>
                        <td style={leftCell}>{r.escalatedTo ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
