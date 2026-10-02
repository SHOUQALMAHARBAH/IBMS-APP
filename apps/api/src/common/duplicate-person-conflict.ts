import { ConflictException } from '@nestjs/common';
import { Prisma } from '@ibms/db';

/**
 * TURNS THE DUPLICATE-PREVENTION INDEXES INTO A SENTENCE SOMEBODY CAN ACT ON.
 *
 * Migration `20261107100000` added three partial unique indexes — a company's registration number per
 * office, a beneficial owner per customer, an ACTIVE employee per office — each keyed on a canonical
 * fold of a name or a number. They are the hard half of duplicate prevention and they work.
 *
 * ## Why this file exists: the indexes made ordinary duplicates into 500s
 *
 * Found by the api e2e suite immediately after the indexes landed. `POST /employees` has no P2002
 * mapping at all, so registering a second person of the same name returned **500 Internal Server
 * Error** — and "the system is broken" is the wrong thing to tell somebody whose only mistake was
 * entering a colleague twice. Exactly the shape recorded for `POST /sla/holidays`: a controller that
 * reaches a repository directly has no P2002 mapping, so the first duplicate a real user creates is a
 * 500.
 *
 * `POST /customers` was worse than missing. It already caught P2002 and reported
 * *"Prospect <id> has already been converted to a Customer"* unconditionally — so a duplicate
 * REGISTRATION NUMBER was reported as a prospect-conversion conflict, and as `Prospect undefined` when
 * no prospect was involved at all. A catch-all written when `prospectId` was the table's only unique
 * constraint, kept after it gained siblings.
 *
 * ## THE MEASURED CONSTRAINT: a P2002 from the EXTENDED client cannot say which index fired
 *
 * This file's first two versions both tried to identify the index from the error. Neither works, and
 * the second failure is the one worth recording, because it is a property of the tenant extension
 * rather than of Prisma:
 *
 *   * Keyed on the INDEX NAME — Prisma does not report the name.
 *   * Keyed on `meta.target` — the RAW client reports
 *     `{"modelName":"Customer","target":["organizationId","canonical_name_key(registrationNumber)"]}`,
 *     which is exactly what is needed. **Through `prisma.client` — the `$extends`-wrapped client every
 *     service uses — the same error arrives as `{"modelName":"Customer","target":null}` with the
 *     message `Unique constraint failed on the (not available)`.** The constraint identity is gone.
 *
 * Both probed by provoking the error against each client rather than read off documentation.
 *
 * ## So the precise message comes from a PRE-CHECK, and this is the backstop
 *
 * Each service queries for the colliding row before writing and raises its own 409 naming what
 * collided — the pattern `SlaPolicyService.createHoliday` already established here for the same reason
 * (a 409 naming the day rather than an unhandled P2002). The index stays the real invariant per
 * `race-safe-invariants.md`: a pre-check cannot close a race, and it is not trying to.
 *
 * What this function does is the race, and the little it can say is said honestly. It names the ENTITY,
 * because `meta.modelName` survives the extension, and it does NOT guess which of an entity's
 * constraints fired. A generic 409 is strictly better than a 500 and the pre-check is what a real
 * office sees.
 *
 * Returns `null` for anything else, so each caller keeps its own handling for its own constraints.
 */
const BY_MODEL: Record<string, string> = {
  Customer:
    'This customer could not be created because it duplicates one already recorded in this office. Search for the company or the person before creating a new record.',
  UltimateBeneficialOwner:
    'This beneficial owner could not be added because it duplicates one already recorded against this customer.',
  Employee:
    'This person could not be recorded because they duplicate somebody already in this office.',
};

export function duplicatePersonConflict(
  err: unknown,
): ConflictException | null {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return null;
  }
  const meta = err.meta as { modelName?: unknown } | undefined;
  const model = typeof meta?.modelName === 'string' ? meta.modelName : '';
  const message = BY_MODEL[model];
  return message ? new ConflictException(message) : null;
}
