import type { ScreeningCaseStatus } from '@ibms/db';

/**
 * Part B §16 — the screening case workflow.
 *
 * `ScreeningMatch.status` is the DECISION (pending / cleared / confirmed).
 * `caseStatus` is the workflow around it. They answer different questions —
 * "has anyone looked at this yet?" versus "was it a real match?" — and
 * collapsing them would make "assigned but not yet decided" unrepresentable.
 *
 * ## The rule that matters
 *
 * A decision may only be recorded from `UNDER_REVIEW` or `ESCALATED`. Deciding
 * a case nobody ever picked up is the rubber-stamp this queue exists to
 * prevent, so it is unreachable in the table below rather than merely
 * discouraged.
 *
 * `CLOSED` is terminal. A recorded decision stands: reopening it would let a
 * second reviewer quietly overwrite a colleague's finding and their stated
 * reason, which is the same reason `recordDecision` is status-conditional.
 */
export const CASE_TRANSITIONS: Readonly<
  Record<ScreeningCaseStatus, readonly ScreeningCaseStatus[]>
> = {
  OPEN: ['ASSIGNED'],
  // Re-assignment is legitimate (leave, workload, conflict of interest), so
  // ASSIGNED -> ASSIGNED is allowed.
  ASSIGNED: ['ASSIGNED', 'UNDER_REVIEW', 'ESCALATED'],
  UNDER_REVIEW: ['ESCALATED', 'CLOSED', 'ASSIGNED'],
  // An escalation can be handed back down to a named reviewer, worked directly
  // by whoever it went to, or decided by them.
  ESCALATED: ['ASSIGNED', 'UNDER_REVIEW', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionCase(
  from: ScreeningCaseStatus,
  to: ScreeningCaseStatus,
): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

/** The statuses from which a decision may be recorded. See the header. */
export const DECIDABLE_FROM: readonly ScreeningCaseStatus[] = [
  'UNDER_REVIEW',
  'ESCALATED',
];

export function canDecide(status: ScreeningCaseStatus): boolean {
  return DECIDABLE_FROM.includes(status);
}

/** Human-readable, for an error message that tells an operator what to do
 * rather than only what went wrong. */
export function describeTransition(
  from: ScreeningCaseStatus,
  to: ScreeningCaseStatus,
): string {
  const allowed = CASE_TRANSITIONS[from];
  return allowed.length === 0
    ? `This case is ${from} and is terminal — no further transition is possible.`
    : `A case in ${from} cannot move to ${to}. Allowed from here: ${allowed.join(', ')}.`;
}
