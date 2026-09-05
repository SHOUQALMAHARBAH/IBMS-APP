import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { OpportunityService } from './opportunity.service';
import type { OpportunityRepository } from '../../repositories/opportunity.repository';
import type { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import type { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function placement(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'plc-1',
    email: 'placement@ibms.test',
    roles: ['PLACEMENT_TECHNICAL_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

function makeDeps() {
  const createOpportunity = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'opp-1',
        status: 'NEEDS_CONFIRMED',
        isRenewal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      }),
    );
  const findOpportunityById = vi.fn().mockResolvedValue({
    id: 'opp-1',
    customerId: 'cust-1',
    insuranceProgramId: 'prog-1',
    status: 'NEEDS_CONFIRMED',
    isRenewal: false,
    createdByUserId: 'plc-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const findManyByCustomerId = vi.fn().mockResolvedValue([]);
  const findManyByInsuranceProgramId = vi.fn().mockResolvedValue([]);
  const updateTargetPremiumThreshold = vi
    .fn()
    .mockImplementation((id: string, targetPremiumThreshold: unknown) =>
      Promise.resolve({
        id,
        customerId: 'cust-1',
        insuranceProgramId: 'prog-1',
        status: 'COMPARISON_BUILT',
        isRenewal: false,
        targetPremiumThreshold,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  const opportunities = {
    create: createOpportunity,
    findById: findOpportunityById,
    findManyByCustomerId,
    findManyByInsuranceProgramId,
    updateTargetPremiumThreshold,
  } as unknown as OpportunityRepository;

  const findProgramById = vi.fn().mockResolvedValue({
    id: 'prog-1',
    riskProfileId: 'rp-1',
    status: 'FINALIZED',
  });
  const programs = {
    findById: findProgramById,
  } as unknown as InsuranceProgramRepository;

  const findRiskProfileById = vi
    .fn()
    .mockResolvedValue({ id: 'rp-1', customerId: 'cust-1' });
  const riskProfiles = {
    findById: findRiskProfileById,
  } as unknown as RiskProfileRepository;

  const findCustomerById = vi
    .fn()
    .mockResolvedValue({ id: 'cust-1', ownerUserId: 'sales-1' });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new OpportunityService(
      opportunities,
      programs,
      riskProfiles,
      customers,
      audit,
    ),
    mocks: {
      createOpportunity,
      findOpportunityById,
      findManyByCustomerId,
      findManyByInsuranceProgramId,
      updateTargetPremiumThreshold,
      findProgramById,
      findRiskProfileById,
      findCustomerById,
      record,
    },
  };
}

describe('OpportunityService', () => {
  describe('create', () => {
    it('creates a NEEDS_CONFIRMED Opportunity from a FINALIZED programme and audits CREATE', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.create(
        { insuranceProgramId: 'prog-1' },
        placement(),
      );

      expect(mocks.createOpportunity).toHaveBeenCalledWith({
        customerId: 'cust-1',
        insuranceProgramId: 'prog-1',
        createdByUserId: 'plc-1',
      });
      expect(view.status).toBe('NEEDS_CONFIRMED');
      expect(view.context.customerId).toBe('cust-1');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'Opportunity',
        }),
      );
    });

    it('404s a missing Insurance Program', async () => {
      const { service, mocks } = makeDeps();
      mocks.findProgramById.mockResolvedValue(null);
      await expect(
        service.create({ insuranceProgramId: 'prog-x' }, placement()),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.createOpportunity).not.toHaveBeenCalled();
    });

    it('refuses a programme that is not FINALIZED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findProgramById.mockResolvedValue({
        id: 'prog-1',
        riskProfileId: 'rp-1',
        status: 'DRAFT',
      });
      await expect(
        service.create({ insuranceProgramId: 'prog-1' }, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.createOpportunity).not.toHaveBeenCalled();
    });

    it('refuses a second live Opportunity for the same programme', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByInsuranceProgramId.mockResolvedValue([
        { id: 'opp-0', status: 'RFQ_ISSUED' },
      ]);
      await expect(
        service.create({ insuranceProgramId: 'prog-1' }, placement()),
      ).rejects.toThrow(ConflictException);
      expect(mocks.createOpportunity).not.toHaveBeenCalled();
    });

    it('allows a fresh Opportunity once the previous one is CLOSED_LOST', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByInsuranceProgramId.mockResolvedValue([
        { id: 'opp-0', status: 'CLOSED_LOST' },
      ]);
      await service.create({ insuranceProgramId: 'prog-1' }, placement());
      expect(mocks.createOpportunity).toHaveBeenCalled();
    });

    it('maps the partial-unique-index violation from a concurrent create to a 409', async () => {
      const { service, mocks } = makeDeps();
      mocks.createOpportunity.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.create({ insuranceProgramId: 'prog-1' }, placement()),
      ).rejects.toThrow(ConflictException);
    });

    it('hides a programme on a customer the caller cannot see behind a 404', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.create(
          { insuranceProgramId: 'prog-1' },
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('still returns the Opportunity when the audit write fails', async () => {
      const { service, mocks } = makeDeps();
      mocks.record.mockRejectedValueOnce(new Error('audit down'));
      const view = await service.create(
        { insuranceProgramId: 'prog-1' },
        placement(),
      );
      expect(view.id).toBe('opp-1');
    });
  });

  describe('get / list', () => {
    it('get returns the Opportunity with its context', async () => {
      const { service } = makeDeps();
      const view = await service.get('opp-1', placement());
      expect(view.context.insuranceProgramId).toBe('prog-1');
      expect(view.context.customerId).toBe('cust-1');
    });

    it('list resolves visibility against the customer then returns its opportunities', async () => {
      const { service, mocks } = makeDeps();
      await service.list('cust-1', placement());
      expect(mocks.findCustomerById).toHaveBeenCalledWith('cust-1');
      expect(mocks.findManyByCustomerId).toHaveBeenCalledWith('cust-1');
    });

    it('404s a get on an opportunity the caller cannot see', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.get(
          'opp-1',
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setTargetPremiumThreshold', () => {
    const manager = placement({
      id: 'mgr-1',
      roles: ['BRANCH_DEPARTMENT_MANAGER'],
    });

    it('quantizes and stores a threshold, and audits UPDATE', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'COMPARISON_BUILT',
        isRenewal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await service.setTargetPremiumThreshold(
        'opp-1',
        { targetPremiumThreshold: '250000.5' },
        manager,
      );
      const [, value] = mocks.updateTargetPremiumThreshold.mock.calls[0] as [
        string,
        Prisma.Decimal,
      ];
      expect(value.toFixed(3)).toBe('250000.500');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entityType: 'Opportunity',
        }),
      );
    });

    it('clears the threshold on null', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'RFQ_ISSUED',
        isRenewal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await service.setTargetPremiumThreshold(
        'opp-1',
        { targetPremiumThreshold: null },
        manager,
      );
      expect(mocks.updateTargetPremiumThreshold).toHaveBeenCalledWith(
        'opp-1',
        null,
      );
    });

    it('422s once the Opportunity is past SENT_TO_CLIENT', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'SENT_TO_CLIENT',
        isRenewal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        service.setTargetPremiumThreshold(
          'opp-1',
          { targetPremiumThreshold: '1000.000' },
          manager,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.updateTargetPremiumThreshold).not.toHaveBeenCalled();
    });

    it('422s a negative threshold', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'COMPARISON_BUILT',
        isRenewal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        service.setTargetPremiumThreshold(
          'opp-1',
          { targetPremiumThreshold: '-1.000' },
          manager,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('404s an opportunity the caller cannot see', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.setTargetPremiumThreshold(
          'opp-1',
          { targetPremiumThreshold: '1000.000' },
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
