/**
 * DISCARD — marking a pre-commitment record as raised in error.
 *
 * ## The trap this removes
 *
 * Measured across four modules: there was no route out of any pre-commitment state. The sharpest case is
 * the endorsement — the only exit from a mistakenly raised one was to APPLY it, altering a real policy, its
 * premium and its commission, and then correct it with a second endorsement. **To undo the mistake you had
 * to commit it first.** A broker's first bad keystroke was permanent.
 *
 * ## What discard is, and is not
 *
 *  - A STATE. Nothing is deleted, nothing is rewritten. The row stays visible, marked discarded, carrying
 *    WHO, WHEN and a MANDATORY REASON — the same shape as every other retirement in this system.
 *  - TERMINAL. A discarded record cannot advance, cannot be un-discarded, and cannot be edited. Somebody
 *    who needs a correct one creates a new one.
 *  - Available only BEFORE commitment. An issued policy, a registered claim, a sent recommendation, an
 *    applied endorsement — none may be discarded. Those already have their own correction mechanisms
 *    (endorsement, status trail, a new version) and this changes none of them.
 *
 * ## Why a config rather than four copies of the rule
 *
 * "Cannot advance" is enforced in ONE place — `WorkflowTransitionService.transition`, which every forward
 * move of a Policy, Claim or Endorsement passes through. That guard needs to know which entity types can
 * carry a discard, and a guard that guesses from the presence of a column would silently stop guarding the
 * day a column is renamed. Registering them here means a new discardable entity has to appear in this list,
 * and the list is what the guard reads.
 *
 * `Recommendation` is NOT a workflow entity — it has no `status` column and its own service drives the
 * Opportunity's transitions instead. Its forward moves (approve, send) are guarded in that service, which is
 * why the table below records how each entity advances as well as when it is committed.
 */

/** The row shape the commitment rule reads. Deliberately minimal: whatever the rule needs, nothing more. */
export interface DiscardableRow {
  status?: string | null;
  sentToClientAt?: Date | null;
  discardedAt?: Date | null;
}

export interface DiscardableEntity {
  /** Matches `WorkflowEntityType` for the three that are workflow entities. */
  readonly entityType: 'Policy' | 'Claim' | 'Endorsement' | 'Recommendation';
  /** The permission that allows discarding one — its own code, per the four-action scheme. */
  readonly permission: string;
  /**
   * True while the record has NOT been committed and may still be discarded.
   *
   * Stated per entity rather than as a shared "is it early" idea, because the commitment point is a
   * business fact and differs: a policy commits when it is ISSUED, a claim when it is REGISTERED with the
   * insurer, a recommendation when it is SENT to the client, an endorsement when it is APPLIED.
   */
  readonly discardableWhen: (row: DiscardableRow) => boolean;
  /** What to tell somebody who tried to discard a committed record. Names the point of no return. */
  readonly committedRefusal: string;
  /** Whether forward movement goes through `WorkflowTransitionService` (and so through its guard). */
  readonly advancesViaWorkflowEngine: boolean;
}

export const DISCARDABLE_ENTITIES: readonly DiscardableEntity[] = [
  {
    entityType: 'Policy',
    permission: 'policy.discard',
    // PLACEMENT_CONFIRMED is the only pre-issuance status a Policy has. Everything after it means the
    // insurer has issued a real policy, which is a document in the world and not ours to erase.
    discardableWhen: (row) => row.status === 'PLACEMENT_CONFIRMED',
    committedRefusal:
      'A policy can only be discarded before it is issued. This one has been issued, so the correction path is an endorsement or a cancellation, not a discard.',
    advancesViaWorkflowEngine: true,
  },
  {
    entityType: 'Claim',
    permission: 'claim.discard',
    // NOTIFIED means the client told us. REGISTERED means we told the insurer — after that there is a claim
    // number in somebody else's system.
    discardableWhen: (row) => row.status === 'NOTIFIED',
    committedRefusal:
      'A claim can only be discarded before it is registered with the insurer. This one is registered, so it is closed or declined through its own status trail, not discarded.',
    advancesViaWorkflowEngine: true,
  },
  {
    entityType: 'Endorsement',
    permission: 'endorsement.discard',
    // Everything up to APPLIED. This is the trap the whole feature exists for: before this, the only exit
    // from a wrongly raised endorsement was to apply it — changing a real policy — and then undo it.
    //
    // SUBMITTED_TO_INSURER is deliberately still discardable. The insurer has been told, which is a fact
    // about the world that a discard cannot retract — so whoever discards it has to tell them, and the
    // mandatory reason is where that is recorded. Refusing the discard instead would leave the only exit
    // being to apply an endorsement nobody wants, which is the trap.
    discardableWhen: (row) =>
      row.status !== 'APPLIED' && row.status !== 'CLIENT_NOTIFIED',
    committedRefusal:
      'An endorsement can only be discarded before it is applied. This one has been applied to the policy, so reversing it is a further endorsement.',
    advancesViaWorkflowEngine: true,
  },
  {
    entityType: 'Recommendation',
    permission: 'recommendation.discard',
    // No status column; being sent to the client is the commitment, and it is a timestamp.
    discardableWhen: (row) => row.sentToClientAt == null,
    committedRefusal:
      'A recommendation can only be discarded before it is sent to the client. This one has been sent, so a different recommendation is a new one, and the client decision records what happened to this.',
    advancesViaWorkflowEngine: false,
  },
];

export function discardableEntity(
  entityType: string,
): DiscardableEntity | undefined {
  return DISCARDABLE_ENTITIES.find((e) => e.entityType === entityType);
}

/**
 * The refusal a FORWARD move gets when the record was discarded.
 *
 * Names the discard explicitly. "Cannot transition from X to Y" would be true and would send the reader
 * looking for a status problem that is not there.
 */
export function discardedRefusal(entityType: string, entityId: string): string {
  return `${entityType} ${entityId} was discarded as raised in error and cannot advance. A discarded record is terminal: if a correct one is needed, create it.`;
}

/** Minimum length for a discard reason, matching the national-ID reveal justification. */
export const DISCARD_REASON_MIN_LENGTH = 10;
