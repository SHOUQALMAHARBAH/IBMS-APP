'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import {
  formatSlaDuration,
  getSlaDashboardSummary,
  getSlaDashboardTimers,
  SLA_TIMER_STATE_FILTERS,
  type SlaDashboardSummary,
  type SlaTimerRow,
  type SlaTimerStateFilter,
} from '../../../lib/sla/sla-dashboard-api';
import {
  pauseSlaTimer,
  resumeSlaTimer,
  slaPauseReasonIsValid,
  SLA_PAUSE_REASON_MIN_LENGTH,
} from '../../../lib/sla/sla-timer-api';
import { hasPermission } from '../../../lib/auth/permissions';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { permissionRefusal, reducedCapability } from '../../../lib/i18n/permission-refusal';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'end',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};
const leftCell: CSSProperties = { ...cell, textAlign: 'start' };
const leftHead: CSSProperties = { ...head, textAlign: 'start' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };

/** Timer state / filter -> label key. These were English constants in
 * lib/sla/sla-dashboard-api.ts; this page is their only consumer, so the
 * labelling moved here where a translator is in scope. */
// TOTAL over the union, not `Record<string, ...>`. As a loose map, adding a
// leaf state compiled fine and rendered the raw word `paused` to an Arabic
// reader; the total form makes the missing key a build error instead
// (IMPROVEMENTS § 1.45 — prefer the form that cannot express the mistake).
const STATE_FILTER_LABEL_KEY: Record<SlaTimerStateFilter, TranslationKey> = {
  on_track: 'slaDashStateOnTrack',
  due_soon: 'slaDashStateDueSoon',
  breached: 'slaDashStateBreached',
  escalated: 'slaDashStateEscalated',
  resolved_on_time: 'slaDashStateResolvedOnTime',
  paused: 'slaDashStatePaused',
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
        border: '1px solid var(--border-subtle)',
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
  // Which row's pause form is open, the reason typed into it, and which row has
  // a request in flight. Three separate pieces of state rather than one object
  // because only the third disables buttons on OTHER rows.
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // useCallback so the two loaders below can depend on it honestly: it closes
  // over `tr`, which changes when the language does.
  const messageFor = useCallback(
    (err: unknown, fallback: string) =>
      err instanceof ApiError && err.status === 403
        ? permissionRefusal(tr, 'slaDashRefusalAct', 'sla-dashboard.view')
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

  const loadTimers = useCallback(
    async (state: SlaTimerStateFilter) => {
      try {
        setTimers(await getSlaDashboardTimers({ state }));
      } catch (err) {
        setTimers(null);
        setLoadError(
          (prev) => prev ?? messageFor(err, tr('slaDashTimerLoadError')),
        );
      }
    },
    [messageFor, tr],
  );

  const doPause = useCallback(
    async (timerId: string, reason: string) => {
      setBusyId(timerId);
      setActionError(null);
      try {
        await pauseSlaTimer(timerId, reason);
        setPausingId(null);
        setPauseReason('');
        await loadTimers(stateFilter);
        await loadSummary();
      } catch (err) {
        setActionError(messageFor(err, tr('slaDashPauseError')));
      } finally {
        setBusyId(null);
      }
    },
    [loadTimers, loadSummary, stateFilter, messageFor, tr],
  );

  const doResume = useCallback(
    async (timerId: string) => {
      setBusyId(timerId);
      setActionError(null);
      try {
        await resumeSlaTimer(timerId);
        await loadTimers(stateFilter);
        // The summary is reloaded too: resuming moves a timer out of the
        // `paused` bucket and can move it straight into `breached`, so leaving
        // the totals stale would contradict the row the reader is looking at.
        await loadSummary();
      } catch (err) {
        setActionError(messageFor(err, tr('slaDashResumeError')));
      } finally {
        setBusyId(null);
      }
    },
    [loadTimers, loadSummary, stateFilter, messageFor, tr],
  );

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

  const canPause = hasPermission(user, 'sla.timer.pause');
  const t = summary?.totals;

  return (
    <main style={pageStyle}>
      <h1>{tr('slaDashHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{tr('slaDashIntro')}</p>

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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <Stat label={tr('slaDashColTimers')} value={t!.total} />
              <Stat label={tr('slaDashOnTrack')} value={t!.onTrack} />
              <Stat label={tr('slaDashDueSoon')} value={t!.dueSoon} />
              <Stat label={tr('slaDashBreached')} value={t!.breached} />
              <Stat label={tr('slaDashEscalated')} value={t!.escalated} />
              {/* Shown unconditionally, including at zero. A paused clock is an
               * exceptional state and "0 paused" is itself the reassurance a
               * compliance reader wants; hiding the tile when empty would make
               * its absence and the value 0 indistinguishable. */}
              <Stat label={tr('slaDashStatePaused')} value={t!.paused} />
              <Stat
                label={tr('slaDashResolved')}
                value={t!.resolvedOnTime + t!.resolvedLate}
              />
              <Stat
                label={tr('slaDashBreachRate')}
                value={`${(Number(t!.breachRate) * 100).toFixed(1)}%`}
              />
            </div>
            {/*
              Item 5 batch 1. This paragraph was entirely hardcoded ENGLISH — not just the provenance
              stamp my first sweep caught, but the two DEFINITIONS with it, which are the sentences that
              make the two figures above readable at all. An Arabic reader got the numbers and none of the
              explanation. Now two translated sentences plus the shared provenance line.
            */}
            <p
              style={{
                color: 'var(--ink-secondary)',
                fontSize: '0.85rem',
                marginTop: '0.5rem',
              }}
            >
              {tr('slaDashDueSoonMeaning', {
                window: formatSlaDuration(summary.dueSoonWindow),
              })}{' '}
              {tr('slaDashBreachRateMeaning')}
            </p>
            <ReportProvenance kind="generatedAt" at={summary.generatedAt} />
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
                              style={{ color: 'var(--ink-secondary)' }}
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
                    {tr(STATE_FILTER_LABEL_KEY[s])}
                  </option>
                ))}
              </select>
            </label>
            {actionError && (
              <p style={errorStyle} role="alert">
                {actionError}
              </p>
            )}
            {!canPause && (
              <p style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                {reducedCapability(tr, 'slaDashPauseCanAct', 'slaDashPauseCannotAct', 'sla.timer.pause')}
              </p>
            )}
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
                    <th style={leftHead}>{tr('slaDashColClock')}</th>
                    {canPause && (
                      <th style={leftHead}>{tr('slaDashColActions')}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {timers == null ? (
                    <tr>
                      <td style={leftCell} colSpan={canPause ? 8 : 7}>
                        {tr('slaDashLoading')}
                      </td>
                    </tr>
                  ) : timers.length === 0 ? (
                    <tr>
                      <td style={leftCell} colSpan={canPause ? 8 : 7}>
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
                        <td style={leftCell}>
                          {tr(STATE_FILTER_LABEL_KEY[r.state])}
                        </td>
                        <td style={cell}>
                          {fmtDate(r.dueAt)}
                          {r.isRegulatory && (
                            <>
                              {' '}
                              <span
                                data-testid={`sla-regulatory-${r.id}`}
                                title={tr('slaDashRegulatoryTitle')}
                                style={{
                                  fontSize: '0.7rem',
                                  border: '1px solid var(--border-default)',
                                  borderRadius: 4,
                                  padding: '0 0.3rem',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {tr('slaDashRegulatory')}
                              </span>
                            </>
                          )}
                        </td>
                        <td style={cell}>
                          {r.overdueDays == null ? '—' : `${r.overdueDays}d`}
                        </td>
                        <td style={leftCell}>{r.escalatedTo ?? '—'}</td>
                        <td style={leftCell} data-testid={`sla-clock-${r.id}`}>
                          {r.pausedAt == null ? (
                            '—'
                          ) : (
                            <>
                              {tr('slaDashPausedSince')} {fmtDate(r.pausedAt)}
                              {r.pauseReason && (
                                <div style={{ opacity: 0.75 }}>
                                  {r.pauseReason}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        {canPause && (
                          <td style={leftCell}>
                            {r.resolvedAt != null ? (
                              '—'
                            ) : r.slaStatus === 'PAUSED' ? (
                              <button
                                type="button"
                                data-testid={`sla-resume-${r.id}`}
                                disabled={busyId === r.id}
                                onClick={() => void doResume(r.id)}
                              >
                                {tr('slaDashResume')}
                              </button>
                            ) : pausingId === r.id ? (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.35rem',
                                  minWidth: '18rem',
                                }}
                              >
                                <label
                                  htmlFor={`sla-pause-reason-${r.id}`}
                                  style={{ fontSize: '0.8rem' }}
                                >
                                  {tr('slaDashPauseReasonLabel')}
                                </label>
                                <textarea
                                  id={`sla-pause-reason-${r.id}`}
                                  data-testid={`sla-pause-reason-${r.id}`}
                                  rows={3}
                                  minLength={SLA_PAUSE_REASON_MIN_LENGTH}
                                  value={pauseReason}
                                  onChange={(ev) =>
                                    setPauseReason(ev.target.value)
                                  }
                                />
                                <p
                                  style={{
                                    fontSize: '0.75rem',
                                    opacity: 0.75,
                                    margin: 0,
                                  }}
                                >
                                  {tr('slaDashPauseReasonHint')}
                                </p>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button
                                    type="button"
                                    data-testid={`sla-pause-confirm-${r.id}`}
                                    disabled={
                                      busyId === r.id ||
                                      !slaPauseReasonIsValid(pauseReason)
                                    }
                                    onClick={() =>
                                      void doPause(r.id, pauseReason)
                                    }
                                  >
                                    {tr('slaDashConfirmPause')}
                                  </button>
                                  <button
                                    type="button"
                                    data-testid={`sla-pause-cancel-${r.id}`}
                                    onClick={() => {
                                      setPausingId(null);
                                      setPauseReason('');
                                      setActionError(null);
                                    }}
                                  >
                                    {tr('slaDashCancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                data-testid={`sla-pause-${r.id}`}
                                disabled={busyId === r.id}
                                onClick={() => {
                                  setPausingId(r.id);
                                  setPauseReason('');
                                  setActionError(null);
                                }}
                              >
                                {tr('slaDashPause')}
                              </button>
                            )}
                          </td>
                        )}
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
