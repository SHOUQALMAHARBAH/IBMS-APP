// Process 43 — SLA Management (backlog Part C #43, Domain E). Reads apps/api's
// GET /sla-dashboard/summary + /sla-dashboard/timers: the cross-module
// monitoring view over the generic SlaTimer engine — book-wide totals and a
// per-workflow / per-entity-type / per-escalation-target breakdown of live
// timer state, plus a filterable per-timer drill-down. `sla-dashboard.view`.

import { apiGet } from '../auth/api-client';

export const SLA_TIMER_LEAF_STATES = [
  'on_track',
  'due_soon',
  'breached',
  'escalated',
  // A deliberately stopped clock. Its own state rather than a flag, because
  // 'on_track' would claim it is running and 'breached' would report a breach
  // that has not happened — which is what this screen used to show.
  'paused',
  'resolved_on_time',
  'resolved_late',
] as const;
export type SlaTimerLeafState = (typeof SLA_TIMER_LEAF_STATES)[number];

export const SLA_TIMER_STATE_FILTERS = [
  ...SLA_TIMER_LEAF_STATES,
  'open',
  'open_breached',
  'at_risk',
  'resolved',
] as const;
export type SlaTimerStateFilter = (typeof SLA_TIMER_STATE_FILTERS)[number];

export interface SlaDuration {
  value: number;
  unit: string;
}

export interface SlaStateCounts {
  total: number;
  onTrack: number;
  dueSoon: number;
  breached: number;
  escalated: number;
  paused: number;
  resolvedOnTime: number;
  resolvedLate: number;
  openBreached: number;
}

export interface SlaWorkflowRow extends SlaStateCounts {
  workflowName: string;
  label: string;
  entityType: string;
  drafted: boolean;
  configuredDuration: SlaDuration | null;
  entityCount: number;
  oldestOverdueDays: number | null;
}

export interface SlaEntityTypeRow extends SlaStateCounts {
  entityType: string;
  entityCount: number;
  oldestOverdueDays: number | null;
}

export interface SlaEscalationTargetRow {
  escalatedTo: string | null;
  open: number;
  openBreached: number;
  oldestOverdueDays: number | null;
}

export interface SlaDashboardSummary {
  generatedAt: string;
  dueSoonWindow: SlaDuration;
  totals: SlaStateCounts & { breachRate: string };
  byWorkflow: SlaWorkflowRow[];
  byEntityType: SlaEntityTypeRow[];
  byEscalationTarget: SlaEscalationTargetRow[];
}

export interface SlaTimerRow {
  id: string;
  entityType: string;
  entityId: string;
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
  ageDays: number;
  overdueDays: number | null;

  /* The API has returned all of the following since SLA policies landed and
   * this interface omitted every one of them, so the screen could not show
   * them and TypeScript could not say so: an interface that simply lacks a
   * field the payload carries is a silent drop, not an error. `isRegulatory`
   * is the sharpest — its own comment on the API side reads "a screen
   * reporting a breach must be able to say whether what was breached is the
   * law", and this screen could not. */

  /** Pause-aware lifecycle status. `PAUSED` is the one `state` cannot express
   * as anything but a guess. */
  slaStatus:
    | 'NOT_STARTED'
    | 'ON_TRACK'
    | 'APPROACHING_DUE'
    | 'BREACHED'
    | 'COMPLETED_WITHIN_SLA'
    | 'COMPLETED_AFTER_SLA'
    | 'PAUSED';
  /** Milliseconds to the pause-adjusted deadline; negative once overdue, null
   * while paused (a stopped clock has no countdown). */
  remainingMs: number | null;
  /** `dueAt` shifted by accumulated pause; `dueAt` itself never moves. */
  effectiveDueAt: string;
  pausedAt: string | null;
  pauseReason: string | null;
  /** TRUE only when the deadline came from a REGULATORY policy. */
  isRegulatory: boolean;
  sourceType: string | null;
  policyCode: string | null;
}

export function getSlaDashboardSummary(): Promise<SlaDashboardSummary> {
  return apiGet('/sla-dashboard/summary');
}

export interface SlaDashboardTimersFilters {
  state?: SlaTimerStateFilter;
  entityType?: string;
  workflowName?: string;
}

export function getSlaDashboardTimers(
  filters: SlaDashboardTimersFilters = {},
): Promise<SlaTimerRow[]> {
  const params = new URLSearchParams();
  if (filters.state) params.set('state', filters.state);
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.workflowName) params.set('workflowName', filters.workflowName);
  const qs = params.toString();
  return apiGet(`/sla-dashboard/timers${qs ? `?${qs}` : ''}`);
}

export function formatSlaDuration(d: SlaDuration | null): string {
  if (!d) return '—';
  const unit =
    d.unit === 'businessDays'
      ? 'business day'
      : d.unit === 'calendarDays'
        ? 'day'
        : d.unit === 'hours'
          ? 'hour'
          : d.unit === 'months'
            ? 'month'
            : d.unit;
  return `${d.value} ${unit}${d.value === 1 ? '' : 's'}`;
}

/* The English `STATE_LABEL` / `slaStateLabel` / `slaStateFilterLabel` trio was
 * REMOVED here, not left dormant. The dashboard screen translates these through
 * `STATE_FILTER_LABEL_KEY` and was the only consumer of `slaStateLabel`;
 * `slaStateFilterLabel` had no consumer at all. On an Arabic-first platform a
 * helper that returns hardcoded English is a trap a future screen would reach
 * for exactly once, and the failure — an Arabic reader seeing "Resolved late" —
 * is one no type or test catches. The vocabulary lives in the dictionary. */
