import { describe, expect, it, vi, type Mock } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
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

  const repo = {
    createCycle: vi.fn().mockResolvedValue({ id: 'cycle-1' }),
    findActiveSubjectUserIds: vi
      .fn()
      .mockResolvedValue(overrides?.activeSubjectUserIds ?? []),
    createManyItems,
    findItemById,
    findItemsByCycle,
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
    ),
    mocks: {
      createManyItems,
      findItemById,
      findItemsByReviewer,
      recordDecision,
      revokeAllActiveRoleAssignmentsForUser,
      findItemsByCycle,
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
  });

  describe('decide', () => {
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
          createdAt: new Date('2026-01-01'),
        },
      ]);
      mocks.findSummariesByIds.mockResolvedValue([
        { id: 'sales-1', fullName: 'Sales Officer', email: 'sales@ibms.test' },
      ]);
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
          reviewerUserId: 'reviewer-1',
          decision: null,
          reviewedAt: null,
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
      mocks.findItemsByCycle.mockResolvedValue([
        { id: 'item-1', subjectUserId: 'admin-1' },
        { id: 'item-2', subjectUserId: 'sales-1' },
      ]);

      const items = await service.getAdminAccessItems('cycle-1');

      expect(items).toEqual([{ id: 'item-1', subjectUserId: 'admin-1' }]);
    });
  });
});
