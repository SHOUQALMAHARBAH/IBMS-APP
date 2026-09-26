import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  pairByConstraint,
  type MakerCheckerConstraint,
} from '../../common/maker-checker-pairs.config';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { CombinedDutyActRepository } from '../../repositories/combined-duty-act.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { PermissionRepository } from '../../repositories/permission.repository';
import { UserRepository } from '../../repositories/user.repository';

/** Matching the discard reason and the national-ID reveal justification. */
export const COMBINED_DUTY_REASON_MIN_LENGTH = 10;

export interface ResolveDutySegregationInput {
  /** Which of the 15 pairs. A compile-time union, so a typo cannot reach a message or a column. */
  constraint: MakerCheckerConstraint;
  makerId: string;
  /** `null`/`undefined` means "not yet decided" — never a violation. */
  checkerId: string | null | undefined;
  /** The record the act is declared against, so the report and the record screen can find each other. */
  entityId: string;
  /** A short call-site label for the refusal, e.g. `Refund.approve`. */
  context: string;
  /**
   * The CHECKER's user id — nothing more.
   *
   * Deliberately not an `AuthenticatedUser`. Of the nineteen call sites, most take a bare `actorUserId`
   * (`KYCRecord.decide`, `Complaint.close`, `DataSharingApproval.approve`, …) and threading a session object
   * down to all of them would mean changing seventeen service signatures and every controller and test that
   * calls them — a large diff whose only purpose is to carry two fields this service can read for itself.
   *
   * It also reads MORE truthfully: the office and the roles are resolved from the database at the moment the
   * act is recorded, so a role revoked earlier in the same request cannot be recorded as the hat.
   */
  actorUserId: string;
  /** The declaration. Required only on the combined path — see `resolve`. */
  reason?: string | null;
}

/**
 * PART 4 — the one place the office's declared duty-segregation mode is applied.
 *
 * ## Why this is a service shared across modules, when domain services never are
 *
 * This codebase shares repositories across modules and never services — with one established exception,
 * which this follows: `WorkflowTransitionService`, an ENGINE that fifteen modules import from its own module
 * because every status change in the system has to pass through one implementation. The same argument holds
 * here. Nineteen call sites in fourteen modules record a checker decision, and "may one person do both
 * halves, and what has to be recorded if they do" must have exactly one answer. Fourteen copies of that is
 * fourteen chances for one of them to skip the recording and still write.
 *
 * It is NOT a domain service: it knows nothing about refunds, claims or disposal batches. It takes a pair, a
 * maker, a checker and an actor, and answers with an id or an exception.
 *
 * ## What it does, in the order the cost matters
 *
 * The overwhelmingly common case — maker and checker are different people — returns immediately with no
 * database read at all. A SEGREGATED office therefore pays nothing for the existence of this mode, which was
 * the design constraint that ruled out reading the mode inside fifteen triggers.
 *
 * Only when the two ids match does it read the office's mode, and only in COMBINED mode does it resolve the
 * hat and write an act.
 */
@Injectable()
export class DutySegregationService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly permissions: PermissionRepository,
    private readonly acts: CombinedDutyActRepository,
    private readonly users: UserRepository,
  ) {}

  /**
   * Returns the escape-column value the caller's write must carry: `null` for every ordinary two-person act,
   * an act id for a declared combined one.
   *
   * Throws exactly as `assertDifferentActors` always did in a SEGREGATED office, so a caller that ignores the
   * return value is no less safe than it was before this existed — and the CHECK constraint refuses the write
   * regardless, since it will carry a null escape column.
   *
   * ## The act is written BEFORE the caller's write, and is not rolled back if that write loses a race
   *
   * The escape column is a foreign key, so the act has to exist first. If the caller's status-conditional
   * update then matches zero rows — somebody else approved it in between — the act remains, and the report
   * shows a declared combined act against a record whose approval did not land.
   *
   * That is deliberate, and it is the conservative direction: the alternative is deleting the act, which
   * would make the evidence table mutable, or threading a transaction client through nineteen repositories.
   * Over-recording a control event is a confusing report row; under-recording one is a missing control. The
   * race also requires two people acting simultaneously in an office that declared COMBINED mode because it
   * has one person.
   */
  async resolve(input: ResolveDutySegregationInput): Promise<string | null> {
    const { makerId, checkerId, constraint, context, actorUserId } = input;

    // The ordinary path: two different people, or no checker yet. No read, no write, no cost.
    if (checkerId == null || checkerId !== makerId) return null;

    const actor = await this.users.findById(actorUserId);
    const office = actor
      ? await this.organizations.findById(actor.organizationId)
      : null;
    if (office?.dutySegregationMode !== 'COMBINED') {
      // Unchanged behaviour, unchanged message — including the remedy naming the checker permission and
      // where to see who holds it (Part 5's honesty fix).
      assertDifferentActors(makerId, checkerId, context, constraint);
      // Unreachable: `assertDifferentActors` throws whenever the ids match, which they do here. Kept so the
      // control flow is readable rather than relying on a thrown exception being obvious.
      return null;
    }

    const pair = pairByConstraint(constraint);
    if (!pair) {
      // Unreachable: `MakerCheckerConstraint` is derived FROM the registry, so a value of that type is always
      // in it. Loud rather than narrowed with a cast, because if this ever fires the registry and the union
      // have come apart and the right answer is a stack trace, not a best guess about which pair was meant.
      throw new Error(
        `${constraint} is typed as a maker/checker constraint but is not in MAKER_CHECKER_REGISTRY. The registry and its derived union have diverged.`,
      );
    }
    const reason = (input.reason ?? '').trim();
    if (reason.length < COMBINED_DUTY_REASON_MIN_LENGTH) {
      // The mode makes a self-approval possible, not silent. Without a reason the record would say only
      // "one person did both halves", which is the part anybody can already see from the two equal ids.
      throw new UnprocessableEntityException(
        `${context}: this office has declared that one person may perform both halves of this operation, so the act has to be recorded. Give a reason of at least ${COMBINED_DUTY_REASON_MIN_LENGTH} characters saying why the same person did both — it is kept permanently and appears in the self-approval report.`,
      );
    }

    // THE HAT. Which of the actor's roles actually grant the checker permission for this pair — a question
    // authorization cannot answer, because `getCodesForRoles` flattens the set and erases provenance.
    //
    // `getRoleRefs` is the same read the session itself is built from, so "the roles she held" here means
    // exactly what it means everywhere else in the system: active assignments of active roles.
    const held = await this.users.getRoleRefs(actorUserId);
    const roleIds = held.map((r) => r.id);
    const granting = await this.permissions.findRolesGrantingCode(
      roleIds,
      pair.checkerPermission,
    );

    const act = await this.acts.create({
      entity: pair.entityType,
      entityId: input.entityId,
      constraintName: constraint,
      actorUserId,
      reason,
      actorRoleIds: roleIds,
      grantingRoleIds: granting.map((r) => r.id),
      grantingRoleNames: granting.map((r) => r.name),
      // The honest answer is sometimes "we cannot tell": two roles granting the same code means the hat is
      // genuinely ambiguous, and the record says so rather than picking one and looking certain.
      multipleGrantingRoles: granting.length > 1,
    });
    return act.id;
  }
}
