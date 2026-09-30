import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DISCARD_REASON_MIN_LENGTH,
  discardableEntity,
  type DiscardableRow,
} from './discard.config';

/**
 * THE ONE PLACE A DISCARD IS DECIDED.
 *
 * Four services call this before writing the three columns, so the rules cannot differ between them: a
 * mandatory reason of real length, a record that has not been committed, and a record that is not already
 * discarded.
 *
 * It does NOT write. The write is a status-conditional update in each repository — re-asserting
 * `discardedAt: null` in its own `where`, so a second discard arriving between this check and that write
 * loses the race explicitly instead of overwriting the first person's reason
 * (`race-safe-invariants.md`). Splitting the decision from the write is what lets the write stay in the
 * repository where every other conditional write in this codebase lives.
 *
 * The database is the backstop for the part that matters most: a CHECK per table refuses a discard whose
 * three columns do not agree, so a caller that skips this function still cannot write a discard with no
 * reason.
 */
export function assertDiscardable(
  entityType: string,
  entityId: string,
  row: DiscardableRow,
  reason: string,
): void {
  const entity = discardableEntity(entityType);
  if (!entity) {
    // A programming error, not a client one: somebody wired a discard for an entity that is not registered.
    // Loud, because the alternative is a discard with no commitment rule — which would let a committed
    // record be discarded, the exact thing rule 3 of this feature forbids.
    throw new Error(
      `${entityType} is not registered as discardable in discard.config.ts. Register it with its commitment rule and its permission, or do not offer a discard for it.`,
    );
  }

  // The PERMISSION is not checked here. It is `@RequirePermissions(entity.permission)` on the route, which
  // is how every permission in this system is enforced — one code, so the guard's OR semantics cannot
  // weaken it, and duplicating it in the service would mean four services injecting PermissionsService to
  // re-derive an answer the guard already gave.

  if (row.discardedAt != null) {
    throw new ConflictException(
      `${entityType} ${entityId} is already discarded. A discard is terminal — it cannot be repeated, reversed, or edited.`,
    );
  }

  const trimmed = reason.trim();
  if (trimmed.length < DISCARD_REASON_MIN_LENGTH) {
    // The reason is the only part of a discard nobody can reconstruct later: who and when are recoverable
    // from an audit row, "why this record should never have existed" is not.
    throw new UnprocessableEntityException(
      `A discard needs a reason of at least ${DISCARD_REASON_MIN_LENGTH} characters saying why this record was raised in error. It stays on the record permanently and is what anybody reading it later has to go on.`,
    );
  }

  if (!entity.discardableWhen(row)) {
    throw new UnprocessableEntityException(entity.committedRefusal);
  }
}

/**
 * The write lost the race — somebody else discarded this record between the check above and the update.
 *
 * Called with the repository's own `discarded` flag, which comes from an `updateMany` re-asserting
 * `discardedAt IS NULL`. A 409 rather than a silent success: the first person's reason is the one on the
 * record, and telling the second caller "done" would leave them believing their reason is what anybody
 * reading it later will see.
 */
export function assertDiscardWon(
  entityType: string,
  entityId: string,
  discarded: boolean,
): void {
  if (!discarded) {
    throw new ConflictException(
      `${entityType} ${entityId} was discarded by somebody else while this request was in flight. The reason recorded on the record is theirs, not the one just submitted.`,
    );
  }
}

/** What a read of a discardable record shows about its discard. Null on every record that is not discarded. */
export interface DiscardView {
  at: Date;
  byUserId: string;
  reason: string;
}

/**
 * ONE shape for all four entities, nested rather than three flat fields.
 *
 * `discard === null` is then the whole question a client has to ask. Three flat nullable fields would make
 * every screen re-derive "is this discarded" from one of them and pick a different one from its neighbour.
 *
 * A partial row is impossible — a CHECK constraint per table refuses any combination other than all three or
 * none — so a partial one here means that constraint is gone, and the loud failure is the correct answer. The
 * alternative, reporting a discarded record as live, is the one direction that must not be silent.
 */
export function discardView(row: {
  discardedAt: Date | null;
  discardedByUserId: string | null;
  discardedReason: string | null;
}): DiscardView | null {
  if (row.discardedAt == null) return null;
  if (row.discardedByUserId == null || row.discardedReason == null) {
    throw new Error(
      'A discarded row is missing its actor or its reason. The all-or-nothing CHECK constraint on this table has been dropped — restore it before trusting any discard on it.',
    );
  }
  return {
    at: row.discardedAt,
    byUserId: row.discardedByUserId,
    reason: row.discardedReason,
  };
}
