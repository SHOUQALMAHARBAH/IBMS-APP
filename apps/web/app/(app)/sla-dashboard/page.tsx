'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import {
  formatSlaDuration,
  getSlaDashboardSummary,
  getSlaDashboardTimers,
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

/** Timer state / filter -> label key. These were English constants in
 * lib/sla/sla-dashboard-api.ts; this page is their only consumer, so the
 * labelling moved here where a translator is in scope. */
const STATE_FILTER_LABEL_KEY: Record<string, TranslationKey> = {
  on_track: 'slaDashStateOnTrack',
  due_soon: 'slaDashStateDueSoon',
  breached: 'slaDashStateBreached',
  escalated: 'slaDashStateEscalated',
  resolved_on_time: 'slaDashStateResolvedOnTime',
  resolved_late: 'slaDashStateResolvedLate',
  open: 'slaDashStateOpen',
  open_breached: 'slaDashStateOpenBreached',
  at_risk: 'slaDashStateAtRisk',
  resolved: 'slaDashStateResolved',
};

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
  // Aliased: this page already binds `t` to the per-workflow totals row
  // (`t!.onTrack`), so the translator cannot take that name here.
  const { t: tr } = useLanguage();

  const [summary, setSummary] = useState<SlaDashboardSummary | null>(null);
  const [timers, setTimers] = useState<SlaTimerRow[] | null>(null);
  const [stateFilter, setStateFilter] = useState<SlaTimerStateFilter>('open');
  const [loadError, setLoadError] = useState<string | null>(null);

  // useCallback so the two loaders below can depend on it honestly: it closes
  // over `tr`, which changes when the language does.
  const messageFor = useCallback(
    (err: unknown, fallback: string) =>
      err instanceof ApiError && err.status === 403
        ? tr('slaDashNoPermission')
        : err instanceof ApiError
          ? err.message
          : fallback,
    [tr],
  );

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getSlaDashboardSummary());
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(messageFor(err, tr('slaDashLoadError')));
    }
  }, [messageFor, tr]);

  const loadTimers = useCallback(async (state: SlaTimerStateFilter) => {
    try {
      setTimers(await getSlaDashboardTimers({ state }));
    } catch (err) {
      setTimers(null);
      setLoadError((prev) =>
        prev ?? messageFor(err, tr('slaDashTimerLoadError')),
      );
    }
  }, [messageFor, tr]);

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
      <h1>{tr('slaDashHeading')}</h1>
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
          <p>{tr('slaDashLoading')}</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}
            >
              <Stat label={tr('slaDashColTimers')} value={t!.total} />
              <Stat label={tr('slaDashOnTrack')} value={t!.onTrack} />
              <Stat label={tr('slaDashDueSoon')} value={t!.dueSoon} />
              <Stat label={tr('slaDashBreached')} value={t!.breached} />
              <Stat label={tr('slaDashEscalated')} value={t!.escalated} />
              <Stat
                label={tr('slaDashResolved')}
                value={t!.resolvedOnTime + t!.resolvedLate}
              />
              <Stat
                label={tr('slaDashBreachRate')}
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
            <h2>{tr('slaDashByWorkflow')}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>{tr('slaDashColWorkflow')}</th>
                    <th style={leftHead}>{tr('slaDashColEntity')}</th>
                    <th style={head}>{tr('slaDashColSla')}</th>
                    <th style={head}>{tr('slaDashOnTrack')}</th>
                    <th style={head}>{tr('slaDashDueSoon')}</th>
                    <th style={head}>{tr('slaDashBreached')}</th>
                    <th style={head}>{tr('slaDashEscalated')}</th>
                    <th style={head}>{tr('slaDashResolved')}</th>
                    <th style={head}>{tr('slaDashOldestOverdue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byWorkflow.length === 0 ? (
                    <tr>
                      <td style={leftCell} colSpan={9}>
                        {tr('slaDashNoTimers')}
                      </td>
                    </tr>
                  ) : (
                    summary.byWorkflow.map((w) => (
                      <tr key={w.workflowName}>
                        <td style={leftCell}>
                          {w.label}
                          {w.drafted ? (
                            <span
                              title={tr('slaDashDraftNote')}
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
            <h2>{tr('slaDashByEntityType')}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>{tr('slaDashColEntityType')}</th>
                    <th style={head}>{tr('slaDashColTimers')}</th>
                    <th style={head}>{tr('slaDashColEntities')}</th>
                    <th style={head}>{tr('slaDashBreached')}</th>
                    <th style={head}>{tr('slaDashEscalated')}</th>
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
            <h2>{tr('slaDashColTimers')}</h2>
            <label
              style={{
                display: 'inline-flex',
                gap: '0.5rem',
                margin: '0.5rem 0',
              }}
            >
              {tr('slaDashShow')}
              <select
                aria-label={tr('slaDashStateFilterAria')}
                value={stateFilter}
                onChange={(ev) =>
                  setStateFilter(ev.target.value as SlaTimerStateFilter)
                }
              >
                {SLA_TIMER_STATE_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {STATE_FILTER_LABEL_KEY[s] ? tr(STATE_FILTER_LABEL_KEY[s]) : s}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
                <thead>
                  <tr>
                    <th style={leftHead}>{tr('slaDashColWorkflow')}</th>
                    <th style={leftHead}>{tr('slaDashColEntity')}</th>
                    <th style={leftHead}>{tr('slaDashColState')}</th>
                    <th style={head}>{tr('slaDashColDue')}</th>
                    <th style={head}>{tr('slaDashOverdue')}</th>
                    <th style={leftHead}>{tr('slaDashEscalatesTo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {timers == null ? (
                    <tr>
                      <td style={leftCell} colSpan={6}>
                        {tr('slaDashLoading')}
                      </td>
                    </tr>
                  ) : timers.length === 0 ? (
                    <tr>
                      <td style={leftCell} colSpan={6}>
                        {tr('slaDashNoTimersInState')}
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
