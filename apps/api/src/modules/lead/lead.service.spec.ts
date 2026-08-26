import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';
import type { LeadRepository } from '../../repositories/lead.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateLeadDto } from './dto/create-lead.dto';

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
      Promise.resolve({ id: 'lead-1', status: 'NEW', ...input }),
    );
  const findById = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const leads = { create, findById, findMany } as unknown as LeadRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn()
    .mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new LeadService(leads, audit, workflow),
    mocks: { create, findById, findMany, record, transition },
  };
}

const CREATE_DTO: CreateLeadDto = {
  fullName: 'Ahmad Test',
  source: 'referral',
  marketingConsentGranted: false,
};

describe('LeadService', () => {
  describe('create', () => {
    it('owns the lead as the creating user and writes a CREATE audit row', async () => {
      const { service, mocks } = makeDeps();

      const lead = await service.create(CREATE_DTO, 'sales-1');

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Ahmad Test',
          ownerUserId: 'sales-1',
        }),
      );
      expect(lead.ownerUserId).toBe('sales-1');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sales-1',
          action: 'CREATE',
          entityType: 'Lead',
          entityId: 'lead-1',
        }),
      );
    });

    it('never accepts marketing consent unticked-by-default as a fallback (Part 6.3 — the caller must say)', async () => {
      const { service, mocks } = makeDeps();

      await service.create(
        { ...CREATE_DTO, marketingConsentGranted: true },
        'sales-1',
      );

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ marketingConsentGranted: true }),
      );
    });
  });

  describe('list', () => {
    it('forces a Sales Officer to their own pipeline even if they ask for another owner', async () => {
      const { service, mocks } = makeDeps();
      const salesUser = makeUser({ id: 'sales-1' });

      await service.list({ ownerUserId: 'sales-2' }, salesUser);

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: 'sales-1' }),
      );
    });

    it('lets a Branch/Department Manager see any owner', async () => {
      const { service, mocks } = makeDeps();
      const manager = makeUser({
        id: 'manager-1',
        roles: ['BRANCH_DEPARTMENT_MANAGER'],
      });

      await service.list({ ownerUserId: 'sales-2' }, manager);

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: 'sales-2' }),
      );
    });

    it('lets a Manager see every owner when none is specified', async () => {
      const { service, mocks } = makeDeps();
      const manager = makeUser({
        id: 'manager-1',
        roles: ['BRANCH_DEPARTMENT_MANAGER'],
      });

      await service.list({}, manager);

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: undefined }),
      );
    });
  });

  describe('transition', () => {
    it('throws NotFoundException for a missing lead', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);

      await expect(
        service.transition('lead-1', 'CONTACTED', 'sales-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects transitioning another officer's lead with the same NotFoundException as a missing one (never ForbiddenException, so the response can't be used as an existence oracle)", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-2',
        status: 'NEW',
      });

      await expect(
        service.transition('lead-1', 'CONTACTED', 'sales-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('delegates to WorkflowTransitionService for the owner, stamping firstContactAt on the move into CONTACTED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-1',
        status: 'NEW',
      });

      const result = await service.transition('lead-1', 'CONTACTED', 'sales-1');

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Lead',
          entityId: 'lead-1',
          toStatus: 'CONTACTED',
          actorUserId: 'sales-1',
        }),
      );
      const [[call]] = mocks.transition.mock.calls as [
        [{ data?: { firstContactAt?: Date } }],
      ];
      expect(call.data?.firstContactAt).toBeInstanceOf(Date);
      expect(result).toEqual({ id: 'lead-1', status: 'CONTACTED' });
    });

    it('does not stamp firstContactAt on a move that is not into CONTACTED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'lead-1',
        ownerUserId: 'sales-1',
        status: 'CONTACTED',
      });

      await service.transition('lead-1', 'QUALIFIED', 'sales-1');

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'QUALIFIED', data: undefined }),
      );
    });
  });
});
