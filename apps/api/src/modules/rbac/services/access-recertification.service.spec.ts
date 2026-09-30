import { describe, expect, it, vi, type Mock } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  combinedOfficeDutySegregation,
  segregatedOfficeDutySegregation,
} from '../../duty-segregation/duty-segregation.double';
import type { DutySegregationService } from '../../duty-segregation/duty-segregation.service';
import { AccessRecertificationService } from './access-recertification.service';
import type { AccessRecertificationRepository } from '../../../repositories/access-recertification.repository';
import type { RoleRepository } from '../../../repositories/role.repository';
import type { UserRepository } from '../../../repositories/user.repository';
import type { AuditService } from '../../audit/audit.service';
import type { SlaTimerService } from '../../sla/sla-timer.service';

interface Mocks {
  createManyItems: Mock;
  findItemById: Mock;
  findItemsByReviewer: Mock;
  recordDecision: Mock;
  revokeAllActiveRoleAssignmentsForUser: Mock;
  findItemsByCycle: Mock;
  findCycles: Mock;
  findSummariesByIds: Mock;
  getRoleNamesByIds: Mock;
  startTimer: Mock;
}

function makeDeps(overrides?: {
  activeSubjectUserIds?: string[];
  complianceOfficers?: string[];
  managers?: string[];
  executives?: string[];
  admins?: string[];
  /** Defaults to a SEGREGATED office, which is what every other test in this file is about. */
  dutySegregation?: DutySegregationService;
}): {
  service: AccessRecertificationService;
  mocks: Mocks;
} {
  const createManyItems = vi.fn(
    (
      cycleId: string,
      pairs: { subjectUserId: string; reviewerUserId: string }[],
    ) =>
      Promise.resolve(
        pairs.map((pair) => ({
          id: `item-${pair.subjectUserId}`,
          cycleId,
          subjectUserId: pair.subjectUserId,
          reviewerUserId: pair.reviewerUserId,
          decision: null,
        })),
      ),
  );
  const findItemById = vi.fn();
  const findItemsByReviewer = vi.fn().mockResolvedValue([]);
  const recordDecision = vi.fn();
  const revokeAllActiveRoleAssignmentsForUser = vi
    .fn()
    .mockResolvedValue(undefined);
  const findItemsByCycle = vi.fn().mockResolvedValue([]);
  const findCycles = vi.fn().mockResolvedValue([]);

  const repo = {
    createCycle: vi.fn().mockResolvedValue({ id: 'cycle-1' }),
    findActiveSubjectUserIds: vi
      .fn()
      .mockResolvedValue(overrides?.activeSubjectUserIds ?? []),
    createManyItems,
    findItemById,
    findItemsByCycle,
    findCycles,
    findItemsByReviewer,
    recordDecision,
    revokeAllActiveRoleAssignmentsForUser,
  } as unknown as AccessRecertificationRepository;

  // Keyed on PERMISSION since Phase 2. The two reviewer tiers are two codes,
  // deliberately: all three seeded reviewer roles hold the eligibility code, so
  // one code cannot express which of them to assign first. `routine` is the
  // preference; `review` is every eligible reviewer and therefore the fallback.
  const usersByPermission: Record<string, string[]> = {
    'access-recertification.review.routine': [
      ...(overrides?.complianceOfficers ?? []),
      ...(overrides?.managers ?? []),
    ],
    // Executives FIRST, deliberately. This query returns users in assignment-row
    // order, which is arbitrary — so a test that listed the routine reviewers
    // first would pass whether the tiers were honoured or flattened, because
    // `pickReviewer` takes the first eligible id either way. Putting the fallback
    // reviewer at the front is what makes the preference test discriminating.
    'access-recertification.review': [
      ...(overrides?.executives ?? []),
      ...(overrides?.complianceOfficers ?? []),
      ...(overrides?.managers ?? []),
    ],
    'user.manage': overrides?.admins ?? [],
  };
  const roles = {
    findActiveUserIdsWithPermission: vi
      .fn()
      .mockImplementation((code: string) =>
        Promise.resolve(usersByPermission[code] ?? []),
      ),
  } as unknown as RoleRepository;

  const findSummariesByIds = vi.fn().mockResolvedValue([]);
  const getRoleNamesByIds = vi.fn().mockResolvedValue(new Map());
  const users = {
    findSummariesByIds,
    getRoleNamesByIds,
  } as unknown as UserRepository;

  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordMany: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const startTimer = vi.fn().mockResolvedValue([]);
  const slaTimer = { startTimer } as unknown as SlaTimerService;

  return {
    service: new AccessRecertificationService(
      repo,
      roles,
      users,
      audit,
      slaTimer,
      // The SHARED double, never a local `mockResolvedValue(null)`. Every self-review assertion in this
      // file would otherwise pass on the mock rather than on the code — the trap
      // `duty-segregation.double.ts` exists for. It refuses exactly as a SEGREGATED office does, through
      // the same `assertDifferentActors`.
      overrides?.dutySegregation ?? segregatedOfficeDutySegregation(),
    ),
    mocks: {
      createManyItems,
      findItemById,
      findItemsByReviewer,
      recordDecision,
      revokeAllActiveRoleAssignmentsForUser,
      findItemsByCycle,
      findCycles,
      findSummariesByIds,
      getRoleNamesByIds,
      startTimer,
    },
  };
}

describe('AccessRecertificationService', () => {
  describe('startCycle', () => {
    it('assigns a reviewer from the Compliance/Manager pool who is not the subject', async () => {
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['sales-1'],
        complianceOfficers: ['compliance-1'],
      });

      await service.startCycle('Q1', new Date(), 'admin-1');

      expect(mocks.createManyItems).toHaveBeenCalledWith('cycle-1', [
        { subjectUserId: 'sales-1', reviewerUserId: 'compliance-1' },
      ]);
    });

    it('PREFERS a routine reviewer over a fallback one when both are available', async () => {
      // The ordering, asserted positively. The fallback test below proves an
      // Executive IS used when nothing else can be; this proves one is not used
      // when something else can.
      //
      // Worth its own test because the ordering survived Phase 2 only
      // deliberately: all three seeded reviewer roles hold
      // `access-recertification.review`, so keying the pool on that one code
      // would have flattened the tiers and let an Executive be assigned while a
      // Compliance Officer was sitting there. The second code
      // (`...review.routine`) is what keeps the preference expressible.
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['sales-1'],
        complianceOfficers: ['compliance-1'],
        executives: ['exec-1'],
      });

      await service.startCycle('Q1', new Date(), 'admin-1');

      expect(mocks.createManyItems).toHaveBeenCalledWith('cycle-1', [
        { subjectUserId: 'sales-1', reviewerUserId: 'compliance-1' },
      ]);
    });

    it('inserts every item in one createManyItems and audits them in one recordMany (not N round-trips)', async () => {
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['sales-1', 'sales-2', 'sales-3'],
        complianceOfficers: ['compliance-1'],
      });
      const recordMany = (
        service as unknown as { audit: { recordMany: Mock; record: Mock } }
      ).audit.recordMany;

      await service.startCycle('Q1', new Date(), 'admin-1');

      expect(mocks.createManyItems).toHaveBeenCalledTimes(1);
      expect(mocks.createManyItems.mock.calls[0][1]).toHaveLength(3);
      expect(recordMany).toHaveBeenCalledTimes(1);
      expect(recordMany.mock.calls[0][0]).toHaveLength(3);
    });

    it("starts the cycle's SLA timer (backlog A.8) once it is created", async () => {
      const dueAt = new Date('2026-09-10T00:00:00.000Z');
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['sales-1'],
        complianceOfficers: ['compliance-1'],
      });

      await service.startCycle('Q1', dueAt, 'admin-1');

      expect(mocks.startTimer).toHaveBeenCalledWith({
        entityType: 'AccessRecertificationCycle',
        entityId: 'cycle-1',
        workflowName: 'quarterly_access_review',
        dueAt,
        actorUserId: 'admin-1',
      });
    });

    it('still returns the created cycle when starting its SLA timer fails', async () => {
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['sales-1'],
        complianceOfficers: ['compliance-1'],
      });
      mocks.startTimer.mockRejectedValue(new Error('sla timer boom'));

      await expect(
        service.startCycle('Q1', new Date(), 'admin-1'),
      ).resolves.toEqual({ id: 'cycle-1' });
    });

    it('never assigns a reviewer who is a Compliance/Manager subject to themselves — falls back to Executive Management', async () => {
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['compliance-1'],
        complianceOfficers: ['compliance-1'], // the only compliance officer IS the subject
        executives: ['exec-1'],
      });

      await service.startCycle('Q1', new Date(), 'admin-1');

      expect(mocks.createManyItems).toHaveBeenCalledWith('cycle-1', [
        { subjectUserId: 'compliance-1', reviewerUserId: 'exec-1' },
      ]);
    });

    it('includes System/Security Administrator subjects — never skips them', async () => {
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['admin-1'],
        managers: ['manager-1'],
        admins: ['admin-1'],
      });

      await service.startCycle('Q1', new Date(), 'admin-1');

      expect(mocks.createManyItems).toHaveBeenCalledWith('cycle-1', [
        { subjectUserId: 'admin-1', reviewerUserId: 'manager-1' },
      ]);
    });

    it('skips (never self-assigns) a subject with no eligible reviewer, without blocking the rest of the cycle', async () => {
      // IN A SEGREGATED OFFICE, which is what the default double models — and that condition is the whole
      // content of this test now. Since the owner chose Option 2, a self-review is POSSIBLE, so "skips" is
      // no longer unconditional: it is what an office that has not declared COMBINED still gets, unchanged.
      // The combined counterpart is the test below.
      const { service, mocks } = makeDeps({
        // "compliance-1" is the only person in the reviewer pool — as a
        // subject, nobody is left to review them. "sales-1" still gets
        // "compliance-1" as their reviewer; one bad subject doesn't block
        // the other.
        activeSubjectUserIds: ['compliance-1', 'sales-1'],
        complianceOfficers: ['compliance-1'],
      });

      await expect(
        service.startCycle('Q1', new Date(), 'admin-1'),
      ).resolves.toBeDefined();
      // Exactly one item — for sales-1. compliance-1 (the un-reviewable
      // subject) is absent from the pair list, not self-assigned.
      expect(mocks.createManyItems).toHaveBeenCalledWith('cycle-1', [
        { subjectUserId: 'sales-1', reviewerUserId: 'compliance-1' },
      ]);
    });

    it('records a DECLARED self-review in a COMBINED office, instead of skipping the subject', async () => {
      // The owner's Option 2, first half: she may review her own access, and she says why at the moment the
      // cycle arranges it — which for this pair is the only moment available, because the reviewer is
      // assigned by the INSERT and `reviewerUserId` is NOT NULL.
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['compliance-1', 'sales-1'],
        complianceOfficers: ['compliance-1'],
        dutySegregation: combinedOfficeDutySegregation('act-self-review-1'),
      });

      await expect(
        service.startCycle(
          'Q1',
          new Date(),
          'compliance-1',
          'I am the only person in this office.',
        ),
      ).resolves.toBeDefined();

      const pairs = mocks.createManyItems.mock.calls[0]?.[1] as {
        id?: string;
        subjectUserId: string;
        reviewerUserId: string;
        combinedDutyActId?: string | null;
      }[];
      // BOTH subjects get an item now: sales-1 reviewed by compliance-1 as always, and compliance-1
      // reviewing herself with the act attached. Before this change the second one was silently absent,
      // which is the trap the decision exists to remove — a one-person office recertified nobody while the
      // cycle reported success.
      expect(pairs).toHaveLength(2);
      const selfReview = pairs.find((p) => p.subjectUserId === 'compliance-1');
      expect(selfReview?.reviewerUserId).toBe('compliance-1');
      // The act id is what the CHECK constraint accepts on INSERT. Asserted explicitly because a pair with
      // reviewer === subject and no act is refused by the database, so dropping it here would surface as a
      // 500 rather than as a wrong value.
      expect(selfReview?.combinedDutyActId).toBe('act-self-review-1');
      // And the item's id was generated up front, because the act has to name the record it excuses.
      expect(selfReview?.id).toMatch(/^[0-9a-f-]{36}$/);
      // sales-1 is untouched: an ordinary two-person review carries no act.
      const ordinary = pairs.find((p) => p.subjectUserId === 'sales-1');
      expect(ordinary?.combinedDutyActId ?? null).toBeNull();
    });

    it('still skips the subject in a COMBINED office when no reason is given', async () => {
      // The mode makes a self-review possible, not automatic. Without a declaration the engine refuses and
      // the subject is skipped exactly as in a segregated office — so a cycle started by a script that
      // knows nothing about this cannot quietly create self-reviews.
      const { service, mocks } = makeDeps({
        activeSubjectUserIds: ['compliance-1', 'sales-1'],
        complianceOfficers: ['compliance-1'],
        dutySegregation: combinedOfficeDutySegregation(),
      });

      await expect(
        service.startCycle('Q1', new Date(), 'compliance-1'),
      ).resolves.toBeDefined();
      expect(mocks.createManyItems).toHaveBeenCalledWith('cycle-1', [
        { subjectUserId: 'sales-1', reviewerUserId: 'compliance-1' },
      ]);
    });
  });

  describe('decide', () => {
    it('records the act on the REVIEW, which is the half Option 2 exists for', async () => {
      // THE LOAD-BEARING TEST OF THE OWNER'S DECISION, and it was missing.
      //
      // A plant that replaced this act with null killed NOTHING — 18/18 green — which means the second act
      // was being written and observed by nobody. That is § 1.51(d): a plant landing on a surface no test
      // can see. And it was the half the decision was actually about, because act 1 can only say she was
      // SET TO review her own access, while this one says she DID, dated to the review.
      const { service, mocks } = makeDeps({
        dutySegregation: combinedOfficeDutySegregation('act-decision-1'),
      });
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        // Reviewer IS the subject: the self-review this cycle already declared.
        subjectUserId: 'compliance-1',
        reviewerUserId: 'compliance-1',
        decision: null,
      });
      mocks.recordDecision.mockResolvedValue({
        id: 'item-1',
        decision: 'confirmed',
      });

      await service.decide(
        'item-1',
        'compliance-1',
        'confirmed',
        'Still the only person here.',
      );

      expect(mocks.recordDecision).toHaveBeenCalledWith(
        'item-1',
        'compliance-1',
        'confirmed',
        'act-decision-1',
      );
    });

    it('refuses a self-review decision with no reason, even in a COMBINED office', async () => {
      // Being asked a SECOND time is the cost of Option 2 and also its point: carrying the first answer
      // forward would date the flagged report line to the arrangement, which is what Option 1 did and why
      // it was rejected. So the reason is required again here, and nothing is written without it.
      const { service, mocks } = makeDeps({
        dutySegregation: combinedOfficeDutySegregation(),
      });
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        subjectUserId: 'compliance-1',
        reviewerUserId: 'compliance-1',
        decision: null,
      });

      await expect(
        service.decide('item-1', 'compliance-1', 'confirmed'),
      ).rejects.toThrow(/at least 10 characters/);
      expect(mocks.recordDecision).not.toHaveBeenCalled();
    });

    it('revokes all of the subject\'s active role assignments on a "revoked" decision', async () => {
      const { service, mocks } = makeDeps();
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        subjectUserId: 'sales-1',
        reviewerUserId: 'manager-1',
        decision: null,
      });
      mocks.recordDecision.mockResolvedValue({
        id: 'item-1',
        decision: 'revoked',
      });

      await service.decide('item-1', 'manager-1', 'revoked');

      expect(mocks.revokeAllActiveRoleAssignmentsForUser).toHaveBeenCalledWith(
        'sales-1',
      );
    });

    it('rejects a decision from someone other than the assigned reviewer', async () => {
      const { service, mocks } = makeDeps();
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        subjectUserId: 'sales-1',
        reviewerUserId: 'manager-1',
        decision: null,
      });

      await expect(
        service.decide('item-1', 'someone-else', 'confirmed'),
      ).rejects.toThrow(ForbiddenException);
      expect(mocks.recordDecision).not.toHaveBeenCalled();
    });

    it('rejects a reviewer deciding their own item, even if one somehow got created', async () => {
      const { service, mocks } = makeDeps();
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        subjectUserId: 'self-1',
        reviewerUserId: 'self-1',
        decision: null,
      });

      await expect(
        service.decide('item-1', 'self-1', 'confirmed'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects deciding an item that was already decided', async () => {
      const { service, mocks } = makeDeps();
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        subjectUserId: 'sales-1',
        reviewerUserId: 'manager-1',
        decision: 'confirmed',
      });

      await expect(
        service.decide('item-1', 'manager-1', 'revoked'),
      ).rejects.toThrow(ConflictException);
    });

    it('closes the double-decide race: a concurrent decide() that already claimed the item (recordDecision returns null) throws a clean ConflictException, not a silent overwrite', async () => {
      const { service, mocks } = makeDeps();
      // Both concurrent calls read the item BEFORE either has decided —
      // the in-app `if (item.decision)` guard above cannot catch this
      // interleaving, only the status-conditional updateMany can.
      mocks.findItemById.mockResolvedValue({
        id: 'item-1',
        subjectUserId: 'sales-1',
        reviewerUserId: 'manager-1',
        decision: null,
      });
      mocks.recordDecision.mockResolvedValue(null);

      await expect(
        service.decide('item-1', 'manager-1', 'confirmed'),
      ).rejects.toThrow(ConflictException);
      expect(mocks.recordDecision).toHaveBeenCalledWith(
        'item-1',
        'manager-1',
        'confirmed',
        // The act on the REVIEW, null here and on every ordinary two-person review. Asserted rather than
        // left off: a spurious act id reaching this write would mean the engine had declared a combined
        // act for a review by a different person, and the ordinary path is the one that must stay free.
        null,
      );
      // The race was lost before any decision was recorded — role
      // assignments must not have been touched.
      expect(
        mocks.revokeAllActiveRoleAssignmentsForUser,
      ).not.toHaveBeenCalled();
    });
  });

  describe('listItemsForReviewer', () => {
    it('returns an empty array without querying user data when there are no items', async () => {
      const { service, mocks } = makeDeps();

      const items = await service.listItemsForReviewer('reviewer-1');

      expect(items).toEqual([]);
      expect(mocks.findSummariesByIds).not.toHaveBeenCalled();
    });

    it("enriches each item with the subject's name, email, cycle label, and current roles", async () => {
      const { service, mocks } = makeDeps();
      mocks.findItemsByReviewer.mockResolvedValue([
        {
          id: 'item-1',
          cycleId: 'cycle-1',
          cycle: { cycleLabel: 'Q1-2026' },
          subjectUserId: 'sales-1',
          reviewerUserId: 'reviewer-1',
          decision: null,
          reviewedAt: null,
          // Part 4 step 5 — the two relations `ITEM_INCLUDE` now fetches. Both null here: an ordinary
          // review of somebody else's access, arranged and undecided.
          combinedDutyAct: null,
          decisionCombinedDutyAct: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);
      // Answers for BOTH batched reads — the subject set and the reviewer set. A mock that only
      // knew the subject would make the reviewer's name fall back to '(deleted user)' and the
      // assertion below would pin that fallback as if it were the answer.
      mocks.findSummariesByIds.mockImplementation((ids: string[]) =>
        Promise.resolve(
          [
            {
              id: 'sales-1',
              fullName: 'Sales Officer',
              email: 'sales@ibms.test',
            },
            {
              id: 'reviewer-1',
              fullName: 'Compliance Officer',
              email: 'co@ibms.test',
            },
          ].filter((u) => ids.includes(u.id)),
        ),
      );
      mocks.getRoleNamesByIds.mockResolvedValue(
        new Map([['sales-1', ['SALES_RELATIONSHIP_OFFICER']]]),
      );

      const items = await service.listItemsForReviewer('reviewer-1');

      expect(items).toEqual([
        {
          id: 'item-1',
          cycleId: 'cycle-1',
          cycleLabel: 'Q1-2026',
          subjectUserId: 'sales-1',
          subjectFullName: 'Sales Officer',
          subjectEmail: 'sales@ibms.test',
          subjectRoles: ['SALES_RELATIONSHIP_OFFICER'],
          // Resolved server-side from `user.manage`, so the review screen does
          // not have to compare role names it can no longer interpret. This
          // subject is not an administrator.
          subjectIsUserAdministrator: false,
          reviewerUserId: 'reviewer-1',
          reviewerFullName: 'Compliance Officer',
          decision: null,
          reviewedAt: null,
          // Part 4 step 5 — TWO acts, and NOT two pairs. `arrangement` is "she was set to review her own
          // access", written when the cycle opened; `decision` is "she did", dated to the review. Both
          // null on an ordinary review, and both are in this TOTAL assertion deliberately: `toEqual` is
          // what made the new fields announce themselves rather than arrive unnoticed.
          arrangementCombinedDutyAct: null,
          decisionCombinedDutyAct: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);
    });
  });

  describe('getAdminAccessItems', () => {
    it('returns only items whose subject can administer users (user.manage), whatever their role is called', async () => {
      // Keyed on the permission since Phase 2. By role NAME this report would
      // quietly omit an office's own administrator role — which is exactly the
      // account Part 5.1 singles out as NOT exempt from recertification, and so
      // exactly the one this report exists to prove was reviewed.
      const { service, mocks } = makeDeps({ admins: ['admin-1'] });
      // The fixture carries the CYCLE relation because the repository read includes it. A
      // fixture that omits a field the read returns is a fixture that lies — and this one used
      // to, because the read was raw.
      mocks.findItemsByCycle.mockResolvedValue([
        {
          id: 'item-1',
          cycleId: 'cycle-1',
          cycle: { cycleLabel: 'Q1-2026' },
          subjectUserId: 'admin-1',
          reviewerUserId: 'reviewer-1',
          decision: 'confirmed',
          reviewedAt: new Date('2026-01-05'),
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'item-2',
          cycleId: 'cycle-1',
          cycle: { cycleLabel: 'Q1-2026' },
          subjectUserId: 'sales-1',
          reviewerUserId: 'reviewer-1',
          decision: null,
          reviewedAt: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);
      mocks.findSummariesByIds.mockImplementation((ids: string[]) =>
        Promise.resolve(
          [
            {
              id: 'admin-1',
              fullName: 'Office Administrator',
              email: 'oa@ibms.test',
            },
            {
              id: 'reviewer-1',
              fullName: 'Compliance Officer',
              email: 'co@ibms.test',
            },
          ].filter((u) => ids.includes(u.id)),
        ),
      );
      mocks.getRoleNamesByIds.mockResolvedValue(
        new Map([['admin-1', ['OFFICE_ADMINISTRATOR']]]),
      );

      const items = await service.getAdminAccessItems('cycle-1');

      expect(items).toHaveLength(1);
      expect(items[0].subjectUserId).toBe('admin-1');
      // The badge must be TRUE here. It is resolved from `user.manage`, and this report selects
      // on the same capability — so a false badge on a row this report returned would mean the
      // two disagreed about who an administrator is.
      expect(items[0].subjectIsUserAdministrator).toBe(true);
    });

    it('names the subject AND the reviewer, because a uuid cannot answer "reviewed by whom"', async () => {
      // The route returned raw rows until 2026-09-28: uuids for both people and no cycle label.
      // That is unreadable by the only person who would ask — and it is the defect the audit
      // trail already had to fix when its "User" column rendered a uuid.
      const { service, mocks } = makeDeps({ admins: ['admin-1'] });
      mocks.findItemsByCycle.mockResolvedValue([
        {
          id: 'item-1',
          cycleId: 'cycle-1',
          cycle: { cycleLabel: 'Q1-2026' },
          subjectUserId: 'admin-1',
          reviewerUserId: 'reviewer-1',
          decision: 'confirmed',
          reviewedAt: new Date('2026-01-05'),
          createdAt: new Date('2026-01-01'),
        },
      ]);
      mocks.findSummariesByIds.mockImplementation((ids: string[]) =>
        Promise.resolve(
          [
            {
              id: 'admin-1',
              fullName: 'Office Administrator',
              email: 'oa@ibms.test',
            },
            {
              id: 'reviewer-1',
              fullName: 'Compliance Officer',
              email: 'co@ibms.test',
            },
          ].filter((u) => ids.includes(u.id)),
        ),
      );
      mocks.getRoleNamesByIds.mockResolvedValue(
        new Map([['admin-1', ['OFFICE_ADMINISTRATOR']]]),
      );

      const [item] = await service.getAdminAccessItems('cycle-1');

      expect(item.subjectFullName).toBe('Office Administrator');
      expect(item.reviewerFullName).toBe('Compliance Officer');
      expect(item.cycleLabel).toBe('Q1-2026');
      expect(item.decision).toBe('confirmed');
    });
  });

  describe('listCycles', () => {
    it("returns the office's cycles so admin-items can be addressed by one", async () => {
      // Without this the only source of a cycle id was the POST /cycles response, so the
      // administrator review record was readable for a cycle you had just started and for no
      // earlier one — while the question it answers is an audit-time one.
      const { service, mocks } = makeDeps();
      mocks.findCycles.mockResolvedValue([
        {
          id: 'cycle-2',
          cycleLabel: 'Q2-2026',
          startedAt: new Date('2026-04-01'),
          dueAt: new Date('2026-04-22'),
          closedAt: null,
        },
        {
          id: 'cycle-1',
          cycleLabel: 'Q1-2026',
          startedAt: new Date('2026-01-01'),
          dueAt: new Date('2026-01-22'),
          closedAt: new Date('2026-01-20'),
        },
      ]);

      const cycles = await service.listCycles();

      expect(cycles.map((c) => c.id)).toEqual(['cycle-2', 'cycle-1']);
      expect(cycles[0].cycleLabel).toBe('Q2-2026');
      expect(cycles[1].closedAt).toEqual(new Date('2026-01-20'));
    });
  });
});
