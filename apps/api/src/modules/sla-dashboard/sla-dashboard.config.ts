import {
  applyDuration,
  type SlaDuration,
} from '../../common/business-days.util';
import {
  findSlaRegistryEntry,
  type SlaRegistryEntry,
} from '../sla/sla-registry.config';

/**
 * Process 43 (backlog Part C #43, Domain E) — SLA Management. Pure, I/O-free
 * builders for the cross-module monitoring dashboard over the generic
 * `SlaTimer` engine (`apps/api/src/modules/sla/`). Mirrors `finance.config.ts`
 * (all aggregation logic lives here, unit-tested; the service only loads rows
 * and writes the READ audit).
 *
 * A `SlaTimer` row is "one deadline plus the one target it escalates to if
 * breached" — a workflow with N escalation stages produces N rows sharing an
 * `entityType`/`entityId`, distinguished by a `::`-suffixed `workflowName`
 * (`SlaTimerService`'s `stageWorkflowName()`). The dashboard therefore counts
 * timer **rows**; `entityCount` per group surfaces how many distinct entities
 * those rows cover.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to`, floored, never negative. */
function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

// --- limits / tunables -------------------------------------------------------

/** In-memory row cap for a single dashboard read — the aggregation is done in
 * Node, not the DB (the #30 / #33 / #40 precedent). The service `logger.warn`s
 * on truncation. */
export const SLA_DASHBOARD_TIMER_LIMIT = 5000;

/**
 * How far ahead of `now` an unresolved, not-yet-breached timer counts as
 * `due_soon` rather than `on_track`. A **dashboard lookahead heuristic, not an
 * SLA registry value** — it changes only which bucket a still-open timer is
 * shown in, never a deadline — so it is outside `pdpl-sla-timers.md`'s "any
 * registry value must be sourced" rule. Drafted, same status as #41's
 * 5-business-day figure / #40's `netPosition` metric; tune freely.
 */
export const SLA_DASHBOARD_DUE_SOON_WINDOW: SlaDuration = {
  value: 3,
  unit: 'calendarDays',
};

/** `now` + {@link SLA_DASHBOARD_DUE_SOON_WINDOW}. */
export function computeDueSoonCutoff(now: Date): Date {
  return applyDuration(now, SLA_DASHBOARD_DUE_SOON_WINDOW);
}

/**
 * `SlaTimer.entityType` values that identify a workflow *about a data subject*.
 * A dashboard read whose loaded set contains one of these flips the READ audit
 * row's `isSensitiveDataAccess` — the mere existence of a DSR / consent-
 * withdrawal / data-sharing / complaint / KYC / claim / incident / legal-hold
 * timer for a person is itself Confidential context
 * (`sensitive-data-handling.md` — an aggregate/monitoring read counts as a
 * sensitive-data access when it reveals that such a workflow exists, even
 * though it exposes no field content; a `/brain-gap` is filed asking the brain
 * to define this set once rather than per-dashboard).
 *
 * Deliberately OUT: the internal-governance timers that name no data subject —
 * `AccessRecertificationCycle`, `AccessDeprovisioningChecklist`, `Vendor`,
 * `DisposalBatch`, `DpiaScreening`, `RenewalCase` (a due-date on a process, not
 * a person's record).
 */
export const SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES = [
  'DataSubjectRequest',
  'ConsentRecord',
  'DataSharingApproval',
  'IncidentReport',
  'Complaint',
  'KYCRecord',
  'Claim',
  'LegalHold',
] as const;

// --- timer state ----------------------------------------------------------------

/** The six mutually-exclusive leaf states a timer is in at a given `now`. */
export const SLA_TIMER_LEAF_STATES = [
  'on_track',
  'due_soon',
  'breached',
  'escalated',
  'resolved_on_time',
  'resolved_late',
] as const;
export type SlaTimerLeafState = (typeof SLA_TIMER_LEAF_STATES)[number];

/** Named unions the `?state=` list filter also accepts. */
export const SLA_TIMER_STATE_GROUPS: Record<
  string,
  readonly SlaTimerLeafState[]
> = {
  open: ['on_track', 'due_soon', 'breached', 'escalated'],
  open_breached: ['breached', 'escalated'],
  at_risk: ['due_soon', 'breached', 'escalated'],
  resolved: ['resolved_on_time', 'resolved_late'],
};

export const SLA_TIMER_STATE_FILTERS = [
  ...SLA_TIMER_LEAF_STATES,
  ...Object.keys(SLA_TIMER_STATE_GROUPS),
] as const;
export type SlaTimerStateFilter = (typeof SLA_TIMER_STATE_FILTERS)[number];

export function stateMatchesFilter(
  state: SlaTimerLeafState,
  filter: SlaTimerStateFilter,
): boolean {
  const group = SLA_TIMER_STATE_GROUPS[filter];
  return group ? group.includes(state) : state === filter;
}

/** Worst-first ordering for the drill-down list. */
const STATE_SEVERITY: Record<SlaTimerLeafState, number> = {
  escalated: 5,
  breached: 4,
  due_soon: 3,
  resolved_late: 2,
  on_track: 1,
  resolved_on_time: 0,
};

/** The minimal `SlaTimer` shape the builders need (matches the Prisma model). */
export interface SlaTimerLike {
  id: string;
  entityType: string;
  entityId: string;
  workflowName: string;
  dueAt: Date;
  escalatedAt: Date | null;
  escalatedTo: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Strips a `SlaTimerService` stage suffix (`workflow::target`) back to the
 * bare registry `workflowName`. A single-stage workflow's row is unsuffixed
 * and returned unchanged. */
export function baseWorkflowName(workflowName: string): string {
  const i = workflowName.indexOf('::');
  return i === -1 ? workflowName : workflowName.slice(0, i);
}

/**
 * The single leaf state of a timer at `now`. Precedence (a resolved timer is
 * never also "breached"; an escalated timer is always past due):
 *   1. resolved & on/before deadline  → resolved_on_time
 *   2. resolved & after deadline      → resolved_late
 *   3. unresolved & escalated         → escalated
 *   4. unresolved & due at/before now → breached
 *   5. unresolved & due within window → due_soon
 *   6. otherwise                      → on_track
 */
export function classifyTimer(
  timer: SlaTimerLike,
  now: Date,
  dueSoonCutoff: Date,
): SlaTimerLeafState {
  if (timer.resolvedAt != null) {
    return timer.resolvedAt.getTime() > timer.dueAt.getTime()
      ? 'resolved_late'
      : 'resolved_on_time';
  }
  if (timer.escalatedAt != null) return 'escalated';
  if (timer.dueAt.getTime() <= now.getTime()) return 'breached';
  if (timer.dueAt.getTime() <= dueSoonCutoff.getTime()) return 'due_soon';
  return 'on_track';
}

/** `now − dueAt` for an open breach; `resolvedAt − dueAt` for a late close;
 * `null` for every on-time / not-yet-due state. */
function overdueDaysFor(
  timer: SlaTimerLike,
  now: Date,
  state: SlaTimerLeafState,
): number | null {
  if (state === 'breached' || state === 'escalated') {
    return wholeDaysBetween(timer.dueAt, now);
  }
  if (state === 'resolved_late' && timer.resolvedAt != null) {
    return wholeDaysBetween(timer.dueAt, timer.resolvedAt);
  }
  return null;
}

// --- per-row view (the /timers list) ------------------------------------------

export interface SlaTimerRow {
  id: string;
  entityType: string;
  entityId: string;
  /** raw — may carry a `::stage` suffix. */
  workflowName: string;
  baseWorkflowName: string;
  label: string;
  drafted: boolean;
  state: SlaTimerLeafState;
  dueAt: string;
  escalatedAt: string | null;
  escalatedTo: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** whole days since `createdAt`. */
  ageDays: number;
  /** see {@link overdueDaysFor} — `null` unless breached / escalated / resolved_late. */
  overdueDays: number | null;
}

function registryFacts(
  base: string,
  fallbackEntityType: string,
): {
  label: string;
  entityType: string;
  drafted: boolean;
  configuredDuration: SlaDuration | null;
} {
  const entry: SlaRegistryEntry | undefined = findSlaRegistryEntry(base);
  return {
    label: entry?.label ?? base,
    entityType: entry?.entityType ?? fallbackEntityType,
    drafted: entry ? entry.citation.startsWith('DRAFT') : false,
    configuredDuration: entry?.duration ?? null,
  };
}

export function deriveSlaTimerRow(
  timer: SlaTimerLike,
  now: Date,
  dueSoonCutoff: Date,
): SlaTimerRow {
  const base = baseWorkflowName(timer.workflowName);
  const facts = registryFacts(base, timer.entityType);
  const state = classifyTimer(timer, now, dueSoonCutoff);
  return {
    id: timer.id,
    entityType: timer.entityType,
    entityId: timer.entityId,
    workflowName: timer.workflowName,
    baseWorkflowName: base,
    label: facts.label,
    drafted: facts.drafted,
    state,
    dueAt: timer.dueAt.toISOString(),
    escalatedAt: timer.escalatedAt?.toISOString() ?? null,
    escalatedTo: timer.escalatedTo,
    resolvedAt: timer.resolvedAt?.toISOString() ?? null,
    createdAt: timer.createdAt.toISOString(),
    ageDays: wholeDaysBetween(timer.createdAt, now),
    overdueDays: overdueDaysFor(timer, now, state),
  };
}

/** Byte-stable string order — no locale, so the result is identical across
 * environments (an ISO-8601 `dueAt` also sorts chronologically this way). */
function compareRaw(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Classify → optional `?state=` filter → worst-first sort (state severity, then
 * oldest deadline first, then `id` for a stable order). Pure; the caller caps
 * the input.
 */
export function buildSlaTimerRows(input: {
  timers: SlaTimerLike[];
  now: Date;
  state?: SlaTimerStateFilter;
}): SlaTimerRow[] {
  const cutoff = computeDueSoonCutoff(input.now);
  const rows = input.timers
    .map((t) => deriveSlaTimerRow(t, input.now, cutoff))
    .filter((r) => !input.state || stateMatchesFilter(r.state, input.state));
  return rows.sort((a, b) => {
    const bySeverity = STATE_SEVERITY[b.state] - STATE_SEVERITY[a.state];
    if (bySeverity !== 0) return bySeverity;
    const byDue = compareRaw(a.dueAt, b.dueAt);
    return byDue !== 0 ? byDue : compareRaw(a.id, b.id);
  });
}

// --- summary aggregation ------------------------------------------------------

export interface SlaStateCounts {
  total: number;
  onTrack: number;
  dueSoon: number;
  breached: number;
  escalated: number;
  resolvedOnTime: number;
  resolvedLate: number;
  /** breached + escalated — unresolved and past its deadline. */
  openBreached: number;
}

export interface SlaWorkflowRow extends SlaStateCounts {
  /** base registry `workflowName` (`::stage` stripped). */
  workflowName: string;
  label: string;
  entityType: string;
  drafted: boolean;
  configuredDuration: SlaDuration | null;
  /** distinct `entityId`s these rows cover (a multi-stage workflow > 1 row/entity). */
  entityCount: number;
  /** max `now − dueAt` across the group's openBreached rows; `null` if none. */
  oldestOverdueDays: number | null;
}

export interface SlaEntityTypeRow extends SlaStateCounts {
  entityType: string;
  entityCount: number;
  oldestOverdueDays: number | null;
}

export interface SlaEscalationTargetRow {
  /** `SlaTimer.escalatedTo` — `null` for a stage with no named target. */
  escalatedTo: string | null;
  /** unresolved timers routed to this target. */
  open: number;
  /** unresolved **and** past due (breached + escalated). */
  openBreached: number;
  oldestOverdueDays: number | null;
}

export interface SlaDashboardSummary {
  generatedAt: string;
  dueSoonWindow: SlaDuration;
  totals: SlaStateCounts & {
    /** (resolvedLate + breached + escalated) ÷ (that + resolvedOnTime),
     * 4 dp; `"0.0000"` when nothing has reached a timeliness verdict. */
    breachRate: string;
  };
  byWorkflow: SlaWorkflowRow[];
  byEntityType: SlaEntityTypeRow[];
  byEscalationTarget: SlaEscalationTargetRow[];
}

function emptyCounts(): SlaStateCounts {
  return {
    total: 0,
    onTrack: 0,
    dueSoon: 0,
    breached: 0,
    escalated: 0,
    resolvedOnTime: 0,
    resolvedLate: 0,
    openBreached: 0,
  };
}

function tally(counts: SlaStateCounts, state: SlaTimerLeafState): void {
  counts.total += 1;
  if (state === 'on_track') counts.onTrack += 1;
  else if (state === 'due_soon') counts.dueSoon += 1;
  else if (state === 'breached') counts.breached += 1;
  else if (state === 'escalated') counts.escalated += 1;
  else if (state === 'resolved_on_time') counts.resolvedOnTime += 1;
  else if (state === 'resolved_late') counts.resolvedLate += 1;
  if (state === 'breached' || state === 'escalated') counts.openBreached += 1;
}

function breachRate(c: SlaStateCounts): string {
  const denom = c.resolvedOnTime + c.resolvedLate + c.breached + c.escalated;
  if (denom === 0) return '0.0000';
  return ((c.resolvedLate + c.breached + c.escalated) / denom).toFixed(4);
}

/** worst-first: openBreached desc, oldestOverdueDays desc (null last), label A→Z. */
function compareWorstFirst(
  a: { openBreached: number; oldestOverdueDays: number | null; label: string },
  b: { openBreached: number; oldestOverdueDays: number | null; label: string },
): number {
  if (b.openBreached !== a.openBreached) return b.openBreached - a.openBreached;
  const ao = a.oldestOverdueDays ?? -1;
  const bo = b.oldestOverdueDays ?? -1;
  if (bo !== ao) return bo - ao;
  return a.label.localeCompare(b.label, 'en');
}

export function buildSlaDashboardSummary(
  timers: SlaTimerLike[],
  now: Date,
): SlaDashboardSummary {
  const cutoff = computeDueSoonCutoff(now);

  const totals = emptyCounts();
  const byWorkflow = new Map<
    string,
    {
      counts: SlaStateCounts;
      entityIds: Set<string>;
      oldestOverdueDays: number | null;
      firstEntityType: string;
    }
  >();
  const byEntityType = new Map<
    string,
    {
      counts: SlaStateCounts;
      entityIds: Set<string>;
      oldestOverdueDays: number | null;
    }
  >();
  // keyed by `escalatedTo` directly — a `null` key (a stage with no named
  // target) is a first-class Map key, so there is no sentinel string.
  const byTarget = new Map<
    string | null,
    {
      escalatedTo: string | null;
      open: number;
      openBreached: number;
      oldestOverdueDays: number | null;
    }
  >();

  for (const timer of timers) {
    const state = classifyTimer(timer, now, cutoff);
    const overdue = overdueDaysFor(timer, now, state);
    const isOpen = state !== 'resolved_on_time' && state !== 'resolved_late';
    const isOpenBreach = state === 'breached' || state === 'escalated';

    tally(totals, state);

    const wfKey = baseWorkflowName(timer.workflowName);
    const wf = byWorkflow.get(wfKey) ?? {
      counts: emptyCounts(),
      entityIds: new Set<string>(),
      oldestOverdueDays: null,
      firstEntityType: timer.entityType,
    };
    tally(wf.counts, state);
    wf.entityIds.add(timer.entityId);
    if (isOpenBreach && overdue != null) {
      wf.oldestOverdueDays = Math.max(wf.oldestOverdueDays ?? 0, overdue);
    }
    byWorkflow.set(wfKey, wf);

    const et = byEntityType.get(timer.entityType) ?? {
      counts: emptyCounts(),
      entityIds: new Set<string>(),
      oldestOverdueDays: null,
    };
    tally(et.counts, state);
    et.entityIds.add(timer.entityId);
    if (isOpenBreach && overdue != null) {
      et.oldestOverdueDays = Math.max(et.oldestOverdueDays ?? 0, overdue);
    }
    byEntityType.set(timer.entityType, et);

    const tgt = byTarget.get(timer.escalatedTo) ?? {
      escalatedTo: timer.escalatedTo,
      open: 0,
      openBreached: 0,
      oldestOverdueDays: null,
    };
    if (isOpen) tgt.open += 1;
    if (isOpenBreach) {
      tgt.openBreached += 1;
      if (overdue != null) {
        tgt.oldestOverdueDays = Math.max(tgt.oldestOverdueDays ?? 0, overdue);
      }
    }
    byTarget.set(timer.escalatedTo, tgt);
  }

  const workflowRows: SlaWorkflowRow[] = [...byWorkflow.entries()]
    .map(([workflowName, g]) => {
      const facts = registryFacts(workflowName, g.firstEntityType);
      return {
        workflowName,
        label: facts.label,
        entityType: facts.entityType,
        drafted: facts.drafted,
        configuredDuration: facts.configuredDuration,
        ...g.counts,
        entityCount: g.entityIds.size,
        oldestOverdueDays: g.oldestOverdueDays,
      };
    })
    .sort(compareWorstFirst);

  const entityTypeRows: SlaEntityTypeRow[] = [...byEntityType.entries()]
    .map(([entityType, g]) => ({
      entityType,
      ...g.counts,
      entityCount: g.entityIds.size,
      oldestOverdueDays: g.oldestOverdueDays,
    }))
    .sort((a, b) =>
      compareWorstFirst(
        { ...a, label: a.entityType },
        { ...b, label: b.entityType },
      ),
    );

  const escalationTargetRows: SlaEscalationTargetRow[] = [...byTarget.values()]
    .map((g) => ({
      escalatedTo: g.escalatedTo,
      open: g.open,
      openBreached: g.openBreached,
      oldestOverdueDays: g.oldestOverdueDays,
    }))
    .sort((a, b) => {
      if (b.openBreached !== a.openBreached) {
        return b.openBreached - a.openBreached;
      }
      if (b.open !== a.open) return b.open - a.open;
      if (a.escalatedTo === null || b.escalatedTo === null) {
        return a.escalatedTo === b.escalatedTo
          ? 0
          : a.escalatedTo === null
            ? 1
            : -1;
      }
      return compareRaw(a.escalatedTo, b.escalatedTo);
    });

  return {
    generatedAt: now.toISOString(),
    dueSoonWindow: SLA_DASHBOARD_DUE_SOON_WINDOW,
    totals: { ...totals, breachRate: breachRate(totals) },
    byWorkflow: workflowRows,
    byEntityType: entityTypeRows,
    byEscalationTarget: escalationTargetRows,
  };
}

/** true when any loaded timer names a personal-data-bearing entity type —
 * drives the READ audit row's `isSensitiveDataAccess`. */
export function hasSensitiveEntityType(timers: SlaTimerLike[]): boolean {
  const sensitive = new Set<string>(SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES);
  return timers.some((t) => sensitive.has(t.entityType));
}
