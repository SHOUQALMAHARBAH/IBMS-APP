'use client';

import { errorStyle } from '../../../components/auth/auth-form.styles';
import {
  ErrorState,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
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
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { permissionRefusal, reducedCapability } from '../../../lib/i18n/permission-refusal';
import { slaEntityLabel } from '../../../lib/audit-trail/record-entity-types';

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
    <main style={pageStackStyle}>
      <h1>{tr('slaDashHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{tr('slaDashIntro')}</p>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {!summary ? (
        loadError ? null : (
          <p>{tr('slaDashLoading')}</p>
        )
      ) : (
        <>
          <section style={sectionStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
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
            <Table>
              <thead>
                <tr>
                  <Th>{tr('slaDashColWorkflow')}</Th>
                  <Th>{tr('slaDashColEntity')}</Th>
                  <Th>{tr('slaDashColSla')}</Th>
                  <Th>{tr('slaDashOnTrack')}</Th>
                  <Th>{tr('slaDashDueSoon')}</Th>
                  <Th>{tr('slaDashBreached')}</Th>
                  <Th>{tr('slaDashEscalated')}</Th>
                  <Th>{tr('slaDashResolved')}</Th>
                  <Th>{tr('slaDashOldestOverdue')}</Th>
                </tr>
              </thead>
              <tbody>
                {summary.byWorkflow.length === 0 ? (
                  <Tr>
                    <Td colSpan={9}>
                      {tr('slaDashNoTimers')}
                    </Td>
                  </Tr>
                ) : (
                  summary.byWorkflow.map((w) => (
                    <Tr key={w.workflowName}>
                      <Td>
                        {w.label}
                        {w.drafted ? (
                          <span
                            title={tr('slaDashDraftNote')}
                            style={{ color: 'var(--ink-secondary)' }}
                          >
                            {' '}
                            {tr('statusNoRegulatorySource')}
                          </span>
                        ) : null}
                      </Td>
                      {/* Decision 53 — the TYPE'S WORD, with no number: this row is about a
                          WORKFLOW, not one record, so there is nothing to number. Found by this
                          screen's own Playwright assertion, which asserted the member name was
                          gone and found TWO cells still rendering it — the timer list had been
                          switched and these two tables had not, which is precisely the
                          half-built state the sequencing rule refuses. Neither cell carries a
                          uuid, so the rendered-identifier budget could never have seen them. */}
                      <Td>
                        {slaEntityLabel(w.entityType)
                          ? tr(slaEntityLabel(w.entityType)!)
                          : w.entityType}
                      </Td>
                      <Td>
                        {formatSlaDuration(w.configuredDuration)}
                      </Td>
                      <Td>{w.onTrack}</Td>
                      <Td>{w.dueSoon}</Td>
                      <Td>{w.breached}</Td>
                      <Td>{w.escalated}</Td>
                      <Td>
                        {w.resolvedOnTime + w.resolvedLate}
                      </Td>
                      <Td>
                        {w.oldestOverdueDays == null
                          ? '—'
                          : `${w.oldestOverdueDays}d`}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </section>

          <section style={sectionStyle}>
            <h2>{tr('slaDashByEntityType')}</h2>
            <Table>
              <thead>
                <tr>
                  <Th>{tr('slaDashColEntityType')}</Th>
                  <Th>{tr('slaDashColTimers')}</Th>
                  <Th>{tr('slaDashColEntities')}</Th>
                  <Th>{tr('slaDashBreached')}</Th>
                  <Th>{tr('slaDashEscalated')}</Th>
                </tr>
              </thead>
              <tbody>
                {summary.byEntityType.map((e) => (
                  <Tr key={e.entityType}>
                    {/* The same word, in the by-entity-type breakdown. The KEY stays the stored
                        member name — a React key must be stable and language-independent, and
                        keying on a translated word would re-key every row on a language
                        switch. */}
                    <Td>
                      {slaEntityLabel(e.entityType)
                        ? tr(slaEntityLabel(e.entityType)!)
                        : e.entityType}
                    </Td>
                    <Td>{e.total}</Td>
                    <Td>{e.entityCount}</Td>
                    <Td>{e.breached}</Td>
                    <Td>{e.escalated}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
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
            <Table>
              <thead>
                <tr>
                  <Th>{tr('slaDashColWorkflow')}</Th>
                  <Th>{tr('slaDashColEntity')}</Th>
                  <Th>{tr('slaDashColState')}</Th>
                  <Th>{tr('slaDashColDue')}</Th>
                  <Th>{tr('slaDashOverdue')}</Th>
                  <Th>{tr('slaDashEscalatesTo')}</Th>
                  <Th>{tr('slaDashColClock')}</Th>
                  {canPause && (
                    <Th>{tr('slaDashColActions')}</Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {timers == null ? (
                  <Tr>
                    <Td colSpan={canPause ? 8 : 7}>
                      {tr('slaDashLoading')}
                    </Td>
                  </Tr>
                ) : timers.length === 0 ? (
                  <Tr>
                    <Td colSpan={canPause ? 8 : 7}>
                      {tr('slaDashNoTimersInState')}
                    </Td>
                  </Tr>
                ) : (
                  timers.map((r) => (
                    <Tr key={r.id}>
                      <Td>{r.label}</Td>
                      {/*
                        * OWNER DECISION 53 — the tracked workflow's type in Arabic plus its
                        * number. Sixteen SLA-tracked entity types, closed by the registry's own
                        * inventory spec, so decision 49's test says NAME; all sixteen derived.
                        *
                        * The id stays for the same reason as on `/internal-controls`: an SLA
                        * timer's subject has no readable handle, so the number is the honest
                        * answer to WHICH record rather than an approximation of a name.
                        */}
                      <Td>
                        {slaEntityLabel(r.entityType) ? (
                          tr('atEntityRef', {
                            type: tr(slaEntityLabel(r.entityType)!),
                            ref: r.entityId,
                          })
                        ) : (
                          <span
                            title={tr('atEntityTypeUnlabelled')}
                            style={{
                              fontFamily: 'var(--font-mono, monospace)',
                              color: 'var(--ink-secondary)',
                            }}
                          >
                            {r.entityType} · {r.entityId}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {tr(STATE_FILTER_LABEL_KEY[r.state])}
                      </Td>
                      <Td>
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
                      </Td>
                      <Td>
                        {r.overdueDays == null ? '—' : `${r.overdueDays}d`}
                      </Td>
                      <Td>{r.escalatedTo ?? '—'}</Td>
                      <Td data-testid={`sla-clock-${r.id}`}>
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
                      </Td>
                      {canPause && (
                        <Td>
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
                        </Td>
                      )}
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </section>
        </>
      )}
    </main>
  );
}
