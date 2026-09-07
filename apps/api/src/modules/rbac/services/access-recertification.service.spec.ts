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

  const roleByName: Record<string, string[]> = {
    COMPLIANCE_OFFICER: overrides?.complianceOfficers ?? [],
    BRANCH_DEPARTMENT_MANAGER: overrides?.managers ?? [],
    EXECUTIVE_MANAGEMENT: overrides?.executives ?? [],
    SYSTEM_SECURITY_ADMINISTRATOR: overrides?.admins ?? [],
  };
  const roles = {
    findActiveUserIdsByRoleName: vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(roleByName[name] ?? []),
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
    it('returns only items whose subject holds SYSTEM_SECURITY_ADMINISTRATOR', async () => {
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
