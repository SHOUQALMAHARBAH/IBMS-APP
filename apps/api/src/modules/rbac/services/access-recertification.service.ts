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
  RoleName,
} from '@ibms/db';
import { assertDifferentActors } from '../../../common/maker-checker.util';
import { AccessRecertificationRepository } from '../../../repositories/access-recertification.repository';
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
  subjectRoles: RoleName[];
  reviewerUserId: string;
  decision: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** Part 10.1 — periodic (quarterly) access-recertification cycle. One item
 * is created per user currently holding any active role (not per
 * UserRoleAssignment row — AccessRecertificationItem has no per-assignment
 * foreign key, so an item stands for "this user's whole access", and a
 * "revoked" decision withdraws every active role they hold).
 *
 * Reviewer assignment: no manager-hierarchy field exists on User/Employee
 * yet, so the reviewer pool is every active COMPLIANCE_OFFICER or
 * BRANCH_DEPARTMENT_MANAGER, falling back to EXECUTIVE_MANAGEMENT — see
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md. The
 * reviewer != subject invariant (maker-checker-segregation.md) is never
 * relaxed: pickReviewer throws rather than ever assigning self-review, and
 * startCycle catches that per subject — skipping (with a logged warning)
 * rather than letting one subject with no eligible reviewer block
 * recertifying everyone else in the org. decide() asserts the invariant
 * again independently, in case it's ever violated some other way.
 *
 * System/Security Administrator subjects are never skipped here — Part
 * 5.1 explicitly calls that role out as the one NOT exempt from
 * recertification of its own access.
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
  ) {}

  async startCycle(
    cycleLabel: string,
    dueAt: Date,
    startedByUserId: string,
  ): Promise<AccessRecertificationCycle> {
    const cycle = await this.repo.createCycle(cycleLabel, dueAt);
    const subjectUserIds = await this.repo.findActiveSubjectUserIds();

    const [complianceOfficers, managers, executives] = await Promise.all([
      this.roles.findActiveUserIdsByRoleName('COMPLIANCE_OFFICER'),
      this.roles.findActiveUserIdsByRoleName('BRANCH_DEPARTMENT_MANAGER'),
      this.roles.findActiveUserIdsByRoleName('EXECUTIVE_MANAGEMENT'),
    ]);
    const primaryPool = [...new Set([...complianceOfficers, ...managers])];
    const fallbackPool = [...new Set(executives)];

    const pairs: { subjectUserId: string; reviewerUserId: string }[] = [];
    for (const subjectUserId of subjectUserIds) {
      try {
        pairs.push({
          subjectUserId,
          reviewerUserId: this.pickReviewer(
            subjectUserId,
            primaryPool,
            fallbackPool,
          ),
        });
      } catch (err) {
        // One subject with no eligible reviewer must not block recertifying
        // everyone else in the org — skip and surface it loudly instead.
        this.logger.warn((err as Error).message);
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
    const items = await this.repo.findItemsByReviewer(reviewerUserId, cycleId);
    if (items.length === 0) return [];

    const subjectIds = [...new Set(items.map((i) => i.subjectUserId))];
    const [subjects, rolesBySubject] = await Promise.all([
      this.users.findSummariesByIds(subjectIds),
      // One query for every subject's roles, not one per item — see
      // UserRepository.getRoleNamesByIds.
      this.users.getRoleNamesByIds(subjectIds),
    ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));

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
        reviewerUserId: item.reviewerUserId,
        decision: item.decision,
        reviewedAt: item.reviewedAt,
        createdAt: item.createdAt,
      };
    });
  }

  async decide(
    itemId: string,
    reviewerUserId: string,
    decision: RecertificationDecision,
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
    // Structurally unreachable given startCycle's reviewer selection, but
    // asserted independently — never trust an invariant held only where it
    // was created. See maker-checker-segregation.md.
    assertDifferentActors(
      item.subjectUserId,
      reviewerUserId,
      'AccessRecertificationItem.decide',
    );
    if (item.decision) {
      throw new ConflictException('This item has already been decided');
    }

    const decided = await this.repo.recordDecision(itemId, decision);
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

  /** The dedicated review record the backlog calls out: surfaces exactly
   * the items whose subject currently holds SYSTEM_SECURITY_ADMINISTRATOR,
   * for reporting/spot-checking that admin access really was reviewed. */
  async getAdminAccessItems(
    cycleId: string,
  ): Promise<AccessRecertificationItem[]> {
    const adminUserIds = new Set(
      await this.roles.findActiveUserIdsByRoleName(
        'SYSTEM_SECURITY_ADMINISTRATOR',
      ),
    );
    const items = await this.repo.findItemsByCycle(cycleId);
    return items.filter((item) => adminUserIds.has(item.subjectUserId));
  }

  private pickReviewer(
    subjectUserId: string,
    primaryPool: string[],
    fallbackPool: string[],
  ): string {
    const primary = primaryPool.find((id) => id !== subjectUserId);
    if (primary) return primary;
    const fallback = fallbackPool.find((id) => id !== subjectUserId);
    if (fallback) return fallback;
    throw new Error(
      `No eligible reviewer (other than the subject) found for user ${subjectUserId} — ` +
        'assign at least one active COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER, or ' +
        'EXECUTIVE_MANAGEMENT other than this user before starting a cycle.',
    );
  }
}
