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

const STATE_LABEL: Record<SlaTimerLeafState, string> = {
  on_track: 'On track',
  due_soon: 'Due soon',
  breached: 'Breached',
  escalated: 'Escalated',
  resolved_on_time: 'Resolved on time',
  resolved_late: 'Resolved late',
};

export function slaStateLabel(state: SlaTimerLeafState): string {
  return STATE_LABEL[state] ?? state;
}

const STATE_FILTER_LABEL: Record<SlaTimerStateFilter, string> = {
  ...STATE_LABEL,
  open: 'Open (unresolved)',
  open_breached: 'Breached or escalated',
  at_risk: 'At risk (due soon / breached / escalated)',
  resolved: 'Resolved (any)',
};

export function slaStateFilterLabel(filter: SlaTimerStateFilter): string {
  return STATE_FILTER_LABEL[filter] ?? filter;
}
