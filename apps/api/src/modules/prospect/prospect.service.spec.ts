import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProspectService } from './prospect.service';
import type { ProspectRepository } from '../../repositories/prospect.repository';
import type { LeadRepository } from '../../repositories/lead.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateProspectDto } from './dto/create-prospect.dto';

function makeUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

function makeDeps() {
  const create = vi
    .fn()
    .mockImplementation((input) =>
      Promise.resolve({ id: 'prospect-1', status: 'qualifying', ...input }),
    );
  const findById = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const prospects = {
    create,
    findById,
    findMany,
  } as unknown as ProspectRepository;

  const findLeadById = vi.fn();
  const leads = { findById: findLeadById } as unknown as LeadRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn()
    .mockResolvedValue({ id: 'lead-1', status: 'CONVERTED_TO_PROSPECT' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new ProspectService(prospects, leads, audit, workflow),
    mocks: { create, findById, findMany, findLeadById, record, transition },
  };
}

const CONVERT_DTO: CreateProspectDto = {
  leadId: 'lead-1',
  companyName: 'Acme Trading Co.',
};

describe('ProspectService', () => {
  describe('convert', () => {
    it('throws NotFoundException for a missing lead', async () => {
      const { service, mocks } = makeDeps();
      mocks.findLeadById.mockResolvedValue(null);

      await expect(service.convert(CONVERT_DTO, 'sales-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it("rejects converting another officer's lead with the same NotFoundException as a missing one", async () => {
      const { service, mocks } = makeDeps();
      mocks.findLeadById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-2',
        status: 'QUALIFIED',
      });

      await expect(service.convert(CONVERT_DTO, 'sales-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it("rejects converting a lead that isn't QUALIFIED without ever writing a Prospect row (no non-atomic-write orphan on the common failure path)", async () => {
      const { service, mocks } = makeDeps();
      mocks.findLeadById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-1',
        status: 'NEW',
      });

      await expect(service.convert(CONVERT_DTO, 'sales-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('creates the Prospect BEFORE transitioning the Lead to CONVERTED_TO_PROSPECT — the risky, user-data-validated write happens first so a failure there never leaves the Lead stuck in a terminal status with no Prospect', async () => {
      const { service, mocks } = makeDeps();
      mocks.findLeadById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-1',
        status: 'QUALIFIED',
      });

      const prospect = await service.convert(CONVERT_DTO, 'sales-1');

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          leadId: 'lead-1',
          companyName: 'Acme Trading Co.',
          salesOwnerUserId: 'sales-1',
          productsOfInterest: [],
        }),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Lead',
          entityId: 'lead-1',
          toStatus: 'CONVERTED_TO_PROSPECT',
          actorUserId: 'sales-1',
        }),
      );
      expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.transition.mock.invocationCallOrder[0],
      );
      expect(prospect.leadId).toBe('lead-1');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sales-1',
          action: 'CREATE',
          entityType: 'Prospect',
          entityId: 'prospect-1',
        }),
      );
    });

    it('still returns the created Prospect even if writing its audit row fails (already-committed work must not be reported as a failure)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findLeadById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-1',
        status: 'QUALIFIED',
      });
      mocks.record.mockRejectedValueOnce(new Error('audit db down'));

      const prospect = await service.convert(CONVERT_DTO, 'sales-1');

      expect(prospect.id).toBe('prospect-1');
    });

    it('quantizes expectedPremium to fils precision before persisting', async () => {
      const { service, mocks } = makeDeps();
      mocks.findLeadById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-1',
        status: 'QUALIFIED',
      });

      await service.convert(
        { ...CONVERT_DTO, expectedPremium: '1250' },
        'sales-1',
      );

      const [[input]] = mocks.create.mock.calls as [
        [{ expectedPremium?: { toFixed(dp: number): string } }],
      ];
      expect(input.expectedPremium?.toFixed(3)).toBe('1250.000');
    });
  });

  describe('list', () => {
    it('forces a Sales Officer to their own prospects even if they ask for another owner', async () => {
      const { service, mocks } = makeDeps();
      const salesUser = makeUser({ id: 'sales-1' });

      await service.list({ salesOwnerUserId: 'sales-2' }, salesUser);

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ salesOwnerUserId: 'sales-1' }),
      );
    });

    it('lets a Branch/Department Manager see any owner', async () => {
      const { service, mocks } = makeDeps();
      const manager = makeUser({
        id: 'manager-1',
        roles: ['BRANCH_DEPARTMENT_MANAGER'],
      });

      await service.list({ salesOwnerUserId: 'sales-2' }, manager);

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ salesOwnerUserId: 'sales-2' }),
      );
    });
  });

  describe('get', () => {
    it('throws NotFoundException for a missing prospect', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);

      await expect(service.get('prospect-1', makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });

    it("hides another officer's prospect behind the same NotFoundException", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'prospect-1',
        salesOwnerUserId: 'sales-2',
      });

      await expect(
        service.get('prospect-1', makeUser({ id: 'sales-1' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets the owning Sales Officer read their own prospect', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'prospect-1',
        salesOwnerUserId: 'sales-1',
      });

      const prospect = await service.get(
        'prospect-1',
        makeUser({ id: 'sales-1' }),
      );
      expect(prospect.id).toBe('prospect-1');
    });

    it('lets a Manager read any prospect', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'prospect-1',
        salesOwnerUserId: 'sales-2',
      });

      const prospect = await service.get(
        'prospect-1',
        makeUser({ id: 'manager-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
      );
      expect(prospect.id).toBe('prospect-1');
    });
  });
});
