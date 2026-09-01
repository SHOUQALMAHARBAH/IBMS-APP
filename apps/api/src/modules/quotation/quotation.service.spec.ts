import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { QuotationService } from './quotation.service';
import type { QuotationRepository } from '../../repositories/quotation.repository';
import type { RfqRepository } from '../../repositories/rfq.repository';
import type { OpportunityRepository } from '../../repositories/opportunity.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
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

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const INSURER = {
  id: 'ins-1',
  name: 'Insurer One',
  nameAr: null,
  financialStrengthRating: 'A',
};

const RFQ_ROW = {
  id: 'rfq-1',
  opportunityId: 'opp-1',
  insuranceLine: 'Property All Risks',
  issuedAt: new Date(),
  followUpThresholdDays: 9,
  issuedByUserId: 'plc-1',
  insurerSubmissions: [
    {
      id: 'sub-1',
      rfqId: 'rfq-1',
      insurerId: 'ins-1',
      status: 'SENT',
      sentAt: new Date(),
      respondedAt: null,
      followUpAlertSentAt: null,
      insurer: INSURER,
    },
  ],
};

function quotationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    rfqId: 'rfq-1',
    insurerId: 'ins-1',
    versionNumber: 1,
    previousVersionId: null,
    isCurrentVersion: true,
    premium: new Prisma.Decimal('125000.500'),
    currency: 'JOD',
    deductible: null,
    limits: null,
    biPeriodMonths: null,
    liabilityLimit: null,
    exclusions: null,
    conditions: null,
    commissionRatePercent: null,
    receivedAt: new Date(),
    capturedByUserId: 'plc-1',
    insurer: INSURER,
    rfq: {
      id: 'rfq-1',
      opportunityId: 'opp-1',
      insuranceLine: 'Property All Risks',
    },
    ...overrides,
  };
}

function makeDeps() {
  const createInitial = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(quotationRow({ ...input, id: 'q-1', versionNumber: 1 })),
    );
  const reviseChain = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        quotationRow({
          ...input,
          id: 'q-2',
          previousVersionId: 'q-1',
          isCurrentVersion: true,
        }),
      ),
    );
  const findById = vi.fn().mockResolvedValue(quotationRow());
  const findManyByRfqId = vi.fn().mockResolvedValue([quotationRow()]);
  const findManyByOpportunityId = vi.fn().mockResolvedValue([quotationRow()]);
  const findManyByCustomerId = vi.fn().mockResolvedValue([quotationRow()]);
  const quotations = {
    createInitial,
    reviseChain,
    findById,
    findManyByRfqId,
    findManyByOpportunityId,
    findManyByCustomerId,
  } as unknown as QuotationRepository;

  const findRfqById = vi.fn().mockResolvedValue({ ...RFQ_ROW });
  const rfqs = { findRfqById } as unknown as RfqRepository;

  const findOpportunityById = vi.fn().mockResolvedValue({
    id: 'opp-1',
    customerId: 'cust-1',
    status: 'RFQ_ISSUED',
    insuranceProgramId: 'prog-1',
  });
  const opportunities = {
    findById: findOpportunityById,
  } as unknown as OpportunityRepository;

  const findCustomerById = vi
    .fn()
    .mockResolvedValue({ id: 'cust-1', ownerUserId: 'sales-9' });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn<
      (params: {
        entityType: string;
        entityId: string;
        toStatus: string;
        data?: { respondedAt?: Date };
      }) => Promise<{ id: string; status: string }>
    >()
    .mockResolvedValue({ id: 'x', status: 'QUOTED' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new QuotationService(
      quotations,
      rfqs,
      opportunities,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      createInitial,
      reviseChain,
      findById,
      findManyByRfqId,
      findManyByOpportunityId,
      findManyByCustomerId,
      findRfqById,
      findOpportunityById,
      findCustomerById,
      record,
      transition,
    },
  };
}

const CAPTURE_DTO = {
  rfqId: 'rfq-1',
  insurerId: 'ins-1',
  premium: '125000.5',
};

describe('QuotationService', () => {
  describe('capture', () => {
    it('captures a version-1 quotation, quantizes premium, audits CREATE, and returns the chain view', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.capture(CAPTURE_DTO, placement());

      expect(mocks.createInitial).toHaveBeenCalledWith(
        expect.objectContaining({
          rfqId: 'rfq-1',
          insurerId: 'ins-1',
          capturedByUserId: 'plc-1',
        }),
      );
      // The mock echoes the input's `premium` onto the returned row, so the
      // chain view carries exactly the Prisma.Decimal the service quantized.
      expect(view.current.premium.toFixed(3)).toBe('125000.500');

      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'Quotation',
          entityId: 'q-1',
        }),
      );
      expect(view.current.id).toBe('q-1');
      expect(view.versions).toHaveLength(1);
      expect(view.insuranceLine).toBe('Property All Risks');
    });

    it('best-effort advances the RFQInsurer submission to QUOTED (stamping respondedAt) and the Opportunity to QUOTES_RECEIVED', async () => {
      const { service, mocks } = makeDeps();
      await service.capture(CAPTURE_DTO, placement());

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'RFQInsurer',
          entityId: 'sub-1',
          toStatus: 'QUOTED',
        }),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Opportunity',
          entityId: 'opp-1',
          toStatus: 'QUOTES_RECEIVED',
        }),
      );

      const quotedCall = mocks.transition.mock.calls.find(
        (call) => call[0].entityType === 'RFQInsurer',
      );
      expect(quotedCall?.[0].data?.respondedAt).toBeInstanceOf(Date);
    });

    it('still returns the captured quote when a best-effort transition throws', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValue(new Error('boom'));
      const view = await service.capture(CAPTURE_DTO, placement());
      expect(view.current.id).toBe('q-1');
    });

    it('does not touch the Opportunity status once it is past RFQ_ISSUED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'COMPARISON_BUILT',
        insuranceProgramId: 'prog-1',
      });
      await service.capture(CAPTURE_DTO, placement());
      expect(mocks.transition).not.toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'Opportunity' }),
      );
    });

    it('422 when the insurer is not on the RFQ shortlist', async () => {
      const { service } = makeDeps();
      await expect(
        service.capture({ ...CAPTURE_DTO, insurerId: 'ins-off' }, placement()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when the shortlisted insurer has DECLINED the RFQ', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRfqById.mockResolvedValue({
        ...RFQ_ROW,
        insurerSubmissions: [
          { ...RFQ_ROW.insurerSubmissions[0], status: 'DECLINED' },
        ],
      });
      await expect(
        service.capture(CAPTURE_DTO, placement()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('maps the PARTIAL UNIQUE violation to a 409 pointing at revise', async () => {
      const { service, mocks } = makeDeps();
      mocks.createInitial.mockRejectedValue(p2002());
      await expect(
        service.capture(CAPTURE_DTO, placement()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 when the RFQ does not exist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRfqById.mockResolvedValue(null);
      await expect(
        service.capture(CAPTURE_DTO, placement()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 (no existence oracle) when the customer is not visible to the actor', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'someone-else',
      });
      const salesActor = placement({
        id: 'sales-1',
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      });
      await expect(
        service.capture(CAPTURE_DTO, salesActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revise', () => {
    const REVISE_DTO = { premium: '119000.000' };

    it('reviseChain gets the predecessor + linked-successor inputs, audits CREATE, and returns the chain', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByRfqId.mockResolvedValue([
        quotationRow({ id: 'q-1', versionNumber: 1, isCurrentVersion: false }),
        quotationRow({
          id: 'q-2',
          versionNumber: 2,
          previousVersionId: 'q-1',
          isCurrentVersion: true,
        }),
      ]);

      const view = await service.revise('q-1', REVISE_DTO, placement());

      expect(mocks.reviseChain).toHaveBeenCalledWith(
        expect.objectContaining({
          currentId: 'q-1',
          versionNumber: 2,
          rfqId: 'rfq-1',
          insurerId: 'ins-1',
          capturedByUserId: 'plc-1',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'Quotation',
          entityId: 'q-2',
        }),
      );
      expect(view.current.id).toBe('q-2');
      expect(view.versions).toHaveLength(2);
    });

    it('422 when the target is not the current version of its chain', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        quotationRow({ id: 'q-1', versionNumber: 1, isCurrentVersion: false }),
      );
      await expect(
        service.revise('q-1', REVISE_DTO, placement()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(mocks.reviseChain).not.toHaveBeenCalled();
    });

    it('409 when reviseChain returns null (the conditional clear matched nothing — concurrent revise)', async () => {
      const { service, mocks } = makeDeps();
      mocks.reviseChain.mockResolvedValue(null);
      await expect(
        service.revise('q-1', REVISE_DTO, placement()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s when reviseChain throws P2002 (the successor insert lost the previousVersionId / partial-UNIQUE race)', async () => {
      const { service, mocks } = makeDeps();
      mocks.reviseChain.mockRejectedValue(p2002());
      await expect(
        service.revise('q-1', REVISE_DTO, placement()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 when the quotation id does not exist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);
      await expect(
        service.revise('nope', REVISE_DTO, placement()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('422 when no scope parameter is given', async () => {
      const { service } = makeDeps();
      await expect(service.list({}, placement())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('422 when more than one scope parameter is given', async () => {
      const { service } = makeDeps();
      await expect(
        service.list({ rfqId: 'rfq-1', customerId: 'cust-1' }, placement()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("groups an RFQ's quotation rows into one chain per insurer", async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByRfqId.mockResolvedValue([
        quotationRow({
          id: 'q-1',
          insurerId: 'ins-1',
          versionNumber: 1,
          isCurrentVersion: false,
        }),
        quotationRow({
          id: 'q-2',
          insurerId: 'ins-1',
          versionNumber: 2,
          previousVersionId: 'q-1',
        }),
        quotationRow({
          id: 'q-3',
          insurerId: 'ins-2',
          versionNumber: 1,
          insurer: { ...INSURER, id: 'ins-2' },
        }),
      ]);
      const chains = await service.list({ rfqId: 'rfq-1' }, placement());
      expect(chains).toHaveLength(2);
      const first = chains.find((c) => c.insurerId === 'ins-1');
      expect(first?.versions).toHaveLength(2);
      expect(first?.current.id).toBe('q-2');
    });

    it('resolves customer visibility before returning a customer-scoped list', async () => {
      const { service, mocks } = makeDeps();
      await service.list({ customerId: 'cust-1' }, placement());
      expect(mocks.findCustomerById).toHaveBeenCalledWith('cust-1');
      expect(mocks.findManyByCustomerId).toHaveBeenCalledWith('cust-1');
    });
  });

  describe('get', () => {
    it('404 when the quotation does not exist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);
      await expect(service.get('nope', placement())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the whole chain the quotation belongs to', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        quotationRow({ id: 'q-2', versionNumber: 2, previousVersionId: 'q-1' }),
      );
      mocks.findManyByRfqId.mockResolvedValue([
        quotationRow({ id: 'q-1', versionNumber: 1, isCurrentVersion: false }),
        quotationRow({ id: 'q-2', versionNumber: 2, previousVersionId: 'q-1' }),
      ]);
      const view = await service.get('q-2', placement());
      expect(view.versions.map((v) => v.id)).toEqual(['q-1', 'q-2']);
      expect(view.current.id).toBe('q-2');
    });
  });
});
