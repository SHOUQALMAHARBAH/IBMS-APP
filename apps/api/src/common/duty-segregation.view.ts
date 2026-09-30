import type { CombinedDutyAct } from '@ibms/db';

/**
 * What a RECORD says about a combined-duty act performed on it.
 *
 * Rule 4 of the design: the record screen shows, on the record itself, that both halves were performed by one
 * person under a declared mode — not only in an export. A reader looking at a refund has to be able to see
 * that nobody else signed it without going to find a report.
 *
 * One shape, so the fifteen pairs cannot each invent their own. `roles` is the HAT — the subset that actually
 * granted the checker permission — and `hatAmbiguous` is true when more than one of the actor's roles granted
 * it, which is the record saying "we cannot tell which" rather than picking one.
 */
export interface CombinedDutyActView {
  id: string;
  at: Date;
  actorUserId: string;
  reason: string;
  /** The constraint the act excuses, which is how the act and the database rule stay tied together. */
  pair: string;
  roles: string[];
  hatAmbiguous: boolean;
}

export function combinedDutyActView(
  act: CombinedDutyAct | null | undefined,
): CombinedDutyActView | null {
  if (!act) return null;
  return {
    id: act.id,
    at: act.actedAt,
    actorUserId: act.actorUserId,
    reason: act.reason,
    pair: act.constraintName,
    roles: act.grantingRoleNames,
    hatAmbiguous: act.multipleGrantingRoles,
  };
}
