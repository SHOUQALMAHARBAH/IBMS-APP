import {
  combinedDutyActView,
  type CombinedDutyActView,
} from '../../../common/duty-segregation.view';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AccessRecertificationCycle,
  AccessRecertificationItem,
} from '@ibms/db';
import { randomUUID } from 'node:crypto';
import { DutySegregationService } from '../../duty-segregation/duty-segregation.service';
import {
  AccessRecertificationRepository,
  type AccessRecertificationItemWithCycle,
} from '../../../repositories/access-recertification.repository';
import { RoleRepository } from '../../../repositories/role.repository';
import { UserRepository } from '../../../repositories/user.repository';
import { AuditService } from '../../audit/audit.service';
import { SlaTimerService } from '../../sla/sla-timer.service';

export type RecertificationDecision = 'confirmed' | 'revoked' | 'changed';

/** GET /access-recertification/items response shape — enough for a review
 * screen to render without a separate per-row user lookup. */
export interface RecertificationItemView {
  id: string;
  cycleId: string;
  cycleLabel: string;
  subjectUserId: string;
  subjectFullName: string;
  subjectEmail: string;
  subjectRoles: string[];
  /**
   * Whether this subject can administer users — Part 5.1's "the administrator is
   * NOT exempt from recertification of its own access", which the review screen
   * badges so a reviewer cannot skim past it.
   *
   * Resolved SERVER-SIDE, from `user.manage`. The screen used to derive it by
   * comparing the subject's role names against
   * 'SYSTEM_SECURITY_ADMINISTRATOR', which would silently stop badging an
   * office's own administrator role — the exact account the badge exists to draw
   * attention to. A client cannot answer this question at all once role names
   * are office-chosen.
   */
  subjectIsUserAdministrator: boolean;
  reviewerUserId: string;
  /**
   * WHO reviewed this subject, by name.
   *
   * On the reviewer's own queue this is near-redundant — every row is theirs. It is here for the
   * ADMINISTRATOR record (`getAdminAccessItems`), where it is the whole point: "was this
   * administrator's access reviewed" is only half a question, and the other half is by whom. A
   * screen rendering `reviewerUserId` would put a uuid in front of the person auditing the
   * review, which is the defect the audit trail already had to fix once.
   */
  reviewerFullName: string;
  decision: string | null;
  reviewedAt: Date | null;
  /**
   * Part 4 step 5 — TWO acts, and they are NOT two pairs. The distinction is the whole reason
   * `decisionCombinedDutyActId` exists as a second column beside the escape one:
   *
   *   `arrangementCombinedDutyAct` — she was SET TO review her own access. Written when the cycle OPENED,
   *                                 and in a one-person office it is the only way a cycle can start at
   *                                 all. It says the office had nobody else, not that anybody signed off.
   *   `decisionCombinedDutyAct`    — she DID review it, dated to the review. This is the act a reader is
   *                                 looking for, and it is EVIDENCE rather than an escape column.
   *
   * Both are shown, separately. Collapsing them would report a cycle that merely could not do better as
   * if somebody had signed off on their own access.
   */
  arrangementCombinedDutyAct: CombinedDutyActView | null;
  decisionCombinedDutyAct: CombinedDutyActView | null;
  createdAt: Date;
}

/** GET /access-recertification/cycles response shape. */
export interface RecertificationCycleView {
  id: string;
  cycleLabel: string;
  startedAt: Date;
  dueAt: Date;
  closedAt: Date | null;
}

/** Part 10.1 — periodic (quarterly) access-recertification cycle. One item
 * is created per user currently holding any active role (not per
 * UserRoleAssignment row — AccessRecertificationItem has no per-assignment
 * foreign key, so an item stands for "this user's whole access", and a
 * "revoked" decision withdraws every active role they hold).
 *
 * Reviewer assignment: no manager-hierarchy field exists on User/Employee yet,
 * so the pool is PERMISSION-keyed, in two tiers that predate this phase —
 * holders of `access-recertification.review.routine` are assigned first,
 * falling back to any holder of `access-recertification.review`. Seeded, that is
 * Compliance and line Managers first and Executive Management as the genuine
 * fallback, exactly as before; see
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md.
 *
 * Until Phase 2 those two tiers were two hard-coded lists of role NAMES, which
 * an office defining its own roles appeared in neither of. The cycle then found
 * no eligible reviewer for anybody, skipped every subject with a warning, and
 * completed having recertified nothing — a compliance control reporting success
 * while doing nothing. Keying on permissions is what fixes that; keeping TWO
 * codes is what preserves the ordering, since one code cannot express a
 * preference between roles that all hold it.
 *
 * The reviewer != subject invariant (maker-checker-segregation.md) is never
 * relaxed: pickReviewer throws rather than ever assigning self-review, and
 * startCycle catches that per subject — skipping (with a logged warning)
 * rather than letting one subject with no eligible reviewer block
 * recertifying everyone else in the org. decide() asserts the invariant
 * again independently, in case it's ever violated some other way.
 *
 * Administrator subjects are never skipped here — Part 5.1 explicitly calls
 * that role out as the one NOT exempt from recertification of its own access.
 * Since Phase 2 "administrator" means "holds `user.manage`", so an office's own
 * administrator role is covered too.
 */
@Injectable()
export class AccessRecertificationService {
  private readonly logger = new Logger(AccessRecertificationService.name);

  constructor(
    private readonly repo: AccessRecertificationRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
    private readonly slaTimer: SlaTimerService,
    private readonly dutySegregation: DutySegregationService,
  ) {}

  async startCycle(
    cycleLabel: string,
    dueAt: Date,
    startedByUserId: string,
    /** Required only when a subject has nobody but themselves to review their access — the one-person
     *  office. Every other cycle sends nothing and behaves exactly as before. */
    combinedDutyReason?: string,
  ): Promise<AccessRecertificationCycle> {
    const cycle = await this.repo.createCycle(cycleLabel, dueAt);
    const subjectUserIds = await this.repo.findActiveSubjectUserIds();

    // Two queries, two tiers. The fallback pool is every ELIGIBLE reviewer
    // rather than "the ones that are not routine": a routine reviewer appearing
    // in both is harmless, because the primary tier is exhausted first, and
    // expressing it as a subtraction would mis-handle a user who holds both a
    // routine and a fallback role.
    const [routinePool, eligiblePool] = await Promise.all([
      this.roles.findActiveUserIdsWithPermission(
        'access-recertification.review.routine',
      ),
      this.roles.findActiveUserIdsWithPermission(
        'access-recertification.review',
      ),
    ]);
    const primaryPool = [...new Set(routinePool)];
    const fallbackPool = [...new Set(eligiblePool)];

    const pairs: {
      id?: string;
      subjectUserId: string;
      reviewerUserId: string;
      combinedDutyActId?: string | null;
    }[] = [];
    for (const subjectUserId of subjectUserIds) {
      const reviewerUserId = this.pickReviewerOrSelf(
        subjectUserId,
        primaryPool,
        fallbackPool,
      );
      if (reviewerUserId === null) {
        // Nobody eligible AT ALL — not even the subject. Unchanged behaviour: skip this subject loudly
        // rather than letting one of them block recertifying everyone else.
        this.logger.warn(
          `No eligible reviewer found for user ${subjectUserId} — grant \`access-recertification.review\` ` +
            'to at least one active user before starting a cycle.',
        );
        continue;
      }
      if (reviewerUserId !== subjectUserId) {
        pairs.push({ subjectUserId, reviewerUserId });
        continue;
      }

      // THE ONE-PERSON OFFICE. The owner chose Option 2 of
      // `docs/decision-reviewing-your-own-access.md`: she may review her own access, she says why HERE
      // (this is the moment the self-review is arranged, before anything has been reviewed), and she is
      // asked again at the review itself so the report can be dated to the act rather than the
      // arrangement.
      //
      // The engine decides whether that is allowed. In a SEGREGATED office it throws with the unchanged
      // message, which is why this replaces a skip rather than adding a branch beside it: before, such an
      // office silently recertified nobody. Now it either records a declared act or says why not.
      // The item's id is generated HERE rather than by the database, because the act has to name the
      // record it excuses and the act must exist first — the escape column is an FK, so the ordering is
      // forced. Pointing the act at the cycle instead would make `entity`/`entityId` disagree
      // (`entity` is 'AccessRecertificationItem', from the pair), and the report and the record screen
      // find each other through exactly that pair.
      const itemId = randomUUID();
      try {
        const act = await this.dutySegregation.resolve({
          makerId: subjectUserId,
          checkerId: reviewerUserId,
          constraint: 'AccessRecertificationItem_maker_checker_distinct',
          entityId: itemId,
          context: 'AccessRecertificationService.startCycle',
          actorUserId: startedByUserId,
          reason: combinedDutyReason,
        });
        pairs.push({
          id: itemId,
          subjectUserId,
          reviewerUserId,
          combinedDutyActId: act,
        });
      } catch (err) {
        // A SEGREGATED office, or a COMBINED one with no reason given: the engine refuses, and this subject
        // is SKIPPED exactly as before.
        //
        // The catch is the whole reason this is not simply "let it throw". One subject with nobody else to
        // review them must not block recertifying everyone else in the org — that was the original
        // behaviour and its comment, and the first version of this change lost it: the refusal propagated
        // and aborted the entire cycle. The existing test caught it, which is what that test is for.
        //
        // So an office that has not declared COMBINED behaves precisely as it did: nothing is recorded for
        // this subject and the warning says why.
        this.logger.warn(
          `Skipping recertification of user ${subjectUserId}: nobody else is eligible to review their ` +
            `access, and a self-review was refused — ${(err as Error).message}`,
        );
      }
    }

    // One INSERT for every item + one INSERT for every item's audit row,
    // rather than 2 round-trips per subject over the whole active-user set —
    // the O(N) sequential writes here were what pushed `startCycle` past the
    // e2e test timeout once the shared test DB had accumulated enough users.
    const items = await this.repo.createManyItems(cycle.id, pairs);
    await this.audit.recordMany(
      items.map((item) => ({
        userId: startedByUserId,
        action: 'CREATE' as const,
        entityType: 'AccessRecertificationItem',
        entityId: item.id,
        afterValue: {
          subjectUserId: item.subjectUserId,
          reviewerUserId: item.reviewerUserId,
          cycleId: cycle.id,
        },
      })),
    );

    await this.audit.record({
      userId: startedByUserId,
      action: 'CREATE',
      entityType: 'AccessRecertificationCycle',
      entityId: cycle.id,
      afterValue: {
        cycleLabel,
        dueAt: dueAt.toISOString(),
        itemCount: subjectUserIds.length,
      },
    });

    // Backlog A.8 (ibms-brain/meta/lex/pdpl-sla-timers.md, "Quarterly access
    // review — 15 business days"). Best-effort: the cycle itself is already
    // committed above, so a timer-bookkeeping failure must not roll it back
    // or hide that the cycle started successfully.
    try {
      await this.slaTimer.startTimer({
        entityType: 'AccessRecertificationCycle',
        entityId: cycle.id,
        workflowName: 'quarterly_access_review',
        dueAt,
        actorUserId: startedByUserId,
      });
    } catch (err) {
      this.logger.warn(
        `AccessRecertificationCycle ${cycle.id}: failed to start its SLA timer — cycle itself was created successfully: ${(err as Error).message}`,
      );
    }

    return cycle;
  }

  async listItemsForReviewer(
    reviewerUserId: string,
    cycleId?: string,
  ): Promise<RecertificationItemView[]> {
    return this.enrichItems(
      await this.repo.findItemsByReviewer(reviewerUserId, cycleId),
    );
  }

  /**
   * The office's cycles, newest first.
   *
   * `admin-items` is addressed by a cycle id, and before this nothing could supply one except
   * the `POST /cycles` response — so the administrator review record was readable for a cycle
   * you had just started and for no earlier one, while the question it answers ("were the
   * administrators covered in last quarter's cycle") is an audit-time one.
   */
  async listCycles(): Promise<RecertificationCycleView[]> {
    const cycles = await this.repo.findCycles();
    return cycles.map((cycle) => ({
      id: cycle.id,
      cycleLabel: cycle.cycleLabel,
      startedAt: cycle.startedAt,
      dueAt: cycle.dueAt,
      closedAt: cycle.closedAt,
    }));
  }

  /**
   * Item rows -> view rows, with every lookup BATCHED.
   *
   * Shared by the reviewer's queue and the administrator record rather than written twice: the
   * two differ only in which rows they select, and a second copy is a second place for
   * `(deleted user)` — or the administrator badge, which is resolved from `user.manage` and not
   * from a role name — to drift.
   */
  private async enrichItems(
    items: AccessRecertificationItemWithCycle[],
  ): Promise<RecertificationItemView[]> {
    if (items.length === 0) return [];

    const subjectIds = [...new Set(items.map((i) => i.subjectUserId))];
    const reviewerIds = [...new Set(items.map((i) => i.reviewerUserId))];
    const [subjects, reviewers, rolesBySubject, administrators] =
      await Promise.all([
        this.users.findSummariesByIds(subjectIds),
        // A separate batched read rather than adding the reviewer to the subject set: the two
        // sets overlap only in a declared self-review, and one query each keeps the lookup
        // maps honest about which id came from where.
        this.users.findSummariesByIds(reviewerIds),
        // One query for every subject's roles, not one per item — see
        // UserRepository.getRoleNamesByIds.
        this.users.getRoleNamesByIds(subjectIds),
        // One query for the whole page, same reason. Resolved through the same
        // capability the last-administrator guard uses.
        this.roles.findActiveUserIdsWithPermission('user.manage'),
      ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const reviewerById = new Map(reviewers.map((r) => [r.id, r]));
    const administratorIds = new Set(administrators);

    return items.map((item) => {
      const subject = subjectById.get(item.subjectUserId);
      return {
        id: item.id,
        cycleId: item.cycleId,
        cycleLabel: item.cycle.cycleLabel,
        subjectUserId: item.subjectUserId,
        subjectFullName: subject?.fullName ?? '(deleted user)',
        subjectEmail: subject?.email ?? '',
        subjectRoles: rolesBySubject.get(item.subjectUserId) ?? [],
        subjectIsUserAdministrator: administratorIds.has(item.subjectUserId),
        reviewerUserId: item.reviewerUserId,
        reviewerFullName:
          reviewerById.get(item.reviewerUserId)?.fullName ?? '(deleted user)',
        decision: item.decision,
        reviewedAt: item.reviewedAt,
        arrangementCombinedDutyAct: combinedDutyActView(item.combinedDutyAct),
        decisionCombinedDutyAct: combinedDutyActView(
          item.decisionCombinedDutyAct,
        ),
        createdAt: item.createdAt,
      };
    });
  }

  async decide(
    itemId: string,
    reviewerUserId: string,
    decision: RecertificationDecision,
    /** Required only when the reviewer IS the subject — a self-review the cycle already declared. Every
     *  ordinary review sends nothing. */
    combinedDutyReason?: string,
  ): Promise<AccessRecertificationItem> {
    const item = await this.repo.findItemById(itemId);
    if (!item) {
      throw new NotFoundException('Recertification item not found');
    }
    if (item.reviewerUserId !== reviewerUserId) {
      throw new ForbiddenException(
        'You are not the assigned reviewer for this item',
      );
    }
    // THE SECOND QUESTION, and the one the owner's decision is actually about.
    //
    // This was an unconditional `assertDifferentActors`, and it was structurally unreachable: startCycle
    // never assigned a self-review, so decide() could never see one. It can now, in a COMBINED office
    // that declared one when the cycle opened — so the engine decides, and in a SEGREGATED office it
    // throws with the same message it always did.
    //
    // She is asked a SECOND time rather than the first answer being carried forward, which is Option 2's
    // whole cost and its whole point: the flagged line in the self-approval report is dated to the day she
    // reviewed her own access and says what she did, where act 1 can only say she was set to.
    const decisionAct = await this.dutySegregation.resolve({
      makerId: item.subjectUserId,
      checkerId: reviewerUserId,
      constraint: 'AccessRecertificationItem_maker_checker_distinct',
      entityId: itemId,
      context: 'AccessRecertificationService.decide',
      actorUserId: reviewerUserId,
      reason: combinedDutyReason,
    });
    if (item.decision) {
      throw new ConflictException('This item has already been decided');
    }

    // The pre-check above is a friendly 409 for the common sequential case;
    // this status-conditional write is what actually holds the line against
    // two concurrent decide() calls both passing that check
    // (race-safe-invariants.md).
    const decided = await this.repo.recordDecision(
      itemId,
      reviewerUserId,
      decision,
      decisionAct,
    );
    if (decided === null) {
      throw new ConflictException('This item has already been decided');
    }
    if (decision === 'revoked') {
      await this.repo.revokeAllActiveRoleAssignmentsForUser(item.subjectUserId);
    }

    await this.audit.record({
      userId: reviewerUserId,
      action: 'APPROVE',
      entityType: 'AccessRecertificationItem',
      entityId: itemId,
      afterValue: { decision, subjectUserId: item.subjectUserId },
    });

    return decided;
  }

  /**
   * The dedicated review record the backlog calls out: surfaces exactly the
   * items whose subject can administer users, for reporting and spot-checking
   * that administrator access really was reviewed.
   *
   * Keyed on `user.manage`, not on a role named SYSTEM_SECURITY_ADMINISTRATOR.
   * Part 5.1 names the administrator as the one role NOT exempt from
   * recertification of its own access — a report that found administrators by
   * name would have quietly omitted an office's own administrator role, which is
   * precisely the account this report exists to prove was reviewed.
   *
   * Same capability the last-administrator guard in `UserAdminService` uses, and
   * resolved through the same query, so the two cannot drift apart on what
   * "administrator" means.
   */
  /**
   * The administrator subjects in one cycle, ENRICHED.
   *
   * Part 5.1 is explicit that the administrator is not exempt from recertification of its own
   * access, so this is the record proving they were covered. It returned RAW rows, carrying
   * `subjectUserId` and `reviewerUserId` as uuids and no cycle label — which is unreadable by
   * the only person who would ask, and is the defect the audit trail already had to fix when its
   * "User" column rendered a uuid at whoever was reviewing who did what. It now goes through the
   * same `enrichItems` the reviewer's queue uses.
   */
  async getAdminAccessItems(
    cycleId: string,
  ): Promise<RecertificationItemView[]> {
    const adminUserIds = new Set(
      await this.roles.findActiveUserIdsWithPermission('user.manage'),
    );
    const items = await this.repo.findItemsByCycle(cycleId);
    return this.enrichItems(
      items.filter((item) => adminUserIds.has(item.subjectUserId)),
    );
  }

  /**
   * Who reviews this subject: somebody else if anybody else is eligible, the subject themselves if not,
   * and `null` if nobody is eligible at all.
   *
   * This used to THROW when only the subject was eligible, and `startCycle` caught it per subject and
   * skipped. That is what made a one-person office recertify nobody while reporting success — the trap
   * the owner's decision exists to remove. Returning the subject makes the self-review a case the caller
   * must handle, and the engine is what decides whether the office may have it.
   *
   * The preference order is unchanged: a routine reviewer, then any eligible reviewer, then self. Self is
   * last, never preferred, so an office with anybody else available never produces a self-review.
   */
  private pickReviewerOrSelf(
    subjectUserId: string,
    primaryPool: string[],
    fallbackPool: string[],
  ): string | null {
    const primary = primaryPool.find((id) => id !== subjectUserId);
    if (primary) return primary;
    const fallback = fallbackPool.find((id) => id !== subjectUserId);
    if (fallback) return fallback;
    // Only the subject is eligible. Not an error any more — a case with a decision behind it.
    if (
      primaryPool.includes(subjectUserId) ||
      fallbackPool.includes(subjectUserId)
    ) {
      return subjectUserId;
    }
    return null;
  }
}
