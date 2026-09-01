import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { ComparisonService } from './comparison.service';
import type { ComparisonRepository } from '../../repositories/comparison.repository';
import type { RfqRepository } from '../../repositories/rfq.repository';
import type { QuotationRepository } from '../../repositories/quotation.repository';
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

const insurer = (id: string, name: string) => ({
  id,
  name,
  nameAr: null,
  financialStrengthRating: null,
});

function submission(id: string, insurerId: string, status = 'SENT') {
  return {
    id,
    rfqId: 'rfq-1',
    insurerId,
    status,
    sentAt: new Date(),
    respondedAt: null,
    followUpAlertSentAt: null,
    insurer: insurer(insurerId, `Insurer ${insurerId}`),
  };
}

const RFQ_ROW = {
  id: 'rfq-1',
  opportunityId: 'opp-1',
  insuranceLine: 'Property All Risks',
  issuedAt: new Date(),
  followUpThresholdDays: 9,
  issuedByUserId: 'plc-1',
  insurerSubmissions: [
    submission('sub-1', 'ins-1', 'QUOTED'),
    submission('sub-2', 'ins-2', 'NO_RESPONSE'),
    submission('sub-3', 'ins-3', 'DECLINED'),
  ],
};

function quotationRow(id: string, insurerId: string, isCurrentVersion = true) {
  return {
    id,
    rfqId: 'rfq-1',
    insurerId,
    versionNumber: 1,
    previousVersionId: null,
    isCurrentVersion,
    premium: new Prisma.Decimal('100000.000'),
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
    insurer: insurer(insurerId, `Insurer ${insurerId}`),
    rfq: {
      id: 'rfq-1',
      opportunityId: 'opp-1',
      insuranceLine: 'Property All Risks',
    },
  };
}

function matrixRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cm-1',
    rfqId: 'rfq-1',
    builtAt: new Date(),
    builtByUserId: 'plc-1',
    missingInsurers: ['ins-2'],
    rfq: {
      id: 'rfq-1',
      insuranceLine: 'Property All Risks',
      opportunityId: 'opp-1',
    },
    rows: [
      {
        id: 'row-1',
        comparisonMatrixId: 'cm-1',
        quotationId: 'q-1',
        insurerQualityScore: null,
        serviceScore: null,
        quotation: quotationRow('q-1', 'ins-1'),
      },
    ],
    ...over,
  };
}

function makeDeps() {
  const buildOrRebuild = vi
    .fn()
    .mockResolvedValue({ matrix: matrixRow(), created: true });
  const findByRfqId = vi.fn().mockResolvedValue(null);
  const findById = vi.fn().mockResolvedValue(matrixRow());
  const comparisons = {
    buildOrRebuild,
    findByRfqId,
    findById,
  } as unknown as ComparisonRepository;

  const findRfqById = vi.fn().mockResolvedValue({ ...RFQ_ROW });
  const rfqs = { findRfqById } as unknown as RfqRepository;

  const findManyByRfqId = vi
    .fn()
    .mockResolvedValue([quotationRow('q-1', 'ins-1')]);
  const quotations = { findManyByRfqId } as unknown as QuotationRepository;

  const findOpportunityById = vi.fn().mockResolvedValue({
    id: 'opp-1',
    customerId: 'cust-1',
    status: 'QUOTES_RECEIVED',
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
    .fn()
    .mockResolvedValue({ id: 'opp-1', status: 'COMPARISON_BUILT' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new ComparisonService(
      comparisons,
      rfqs,
      quotations,
      opportunities,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      buildOrRebuild,
      findByRfqId,
      findById,
      findRfqById,
      findManyByRfqId,
      findOpportunityById,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('ComparisonService', () => {
  describe('build', () => {
    it('plans from the current quotes, (re)builds, audits CREATE, advances the Opportunity, and returns a resolved view', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.build({ rfqId: 'rfq-1' }, placement());

      expect(mocks.buildOrRebuild).toHaveBeenCalledWith(
        expect.objectContaining({
          rfqId: 'rfq-1',
          builtByUserId: 'plc-1',
          missingInsurerIds: ['ins-2'],
          rows: [expect.objectContaining({ quotationId: 'q-1' })],
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'ComparisonMatrix',
          entityId: 'cm-1',
        }),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Opportunity',
          entityId: 'opp-1',
          toStatus: 'COMPARISON_BUILT',
        }),
      );
      expect(view.rows).toHaveLength(1);
      expect(view.missingInsurers).toEqual([
        { id: 'ins-2', name: 'Insurer ins-2', status: 'NO_RESPONSE' },
      ]);
      expect(view.declinedInsurers).toEqual([
        { id: 'ins-3', name: 'Insurer ins-3', status: 'DECLINED' },
      ]);
      expect(view.insuranceLine).toBe('Property All Risks');
    });

    it('audits UPDATE when buildOrRebuild reports the matrix already existed', async () => {
      const { service, mocks } = makeDeps();
      mocks.buildOrRebuild.mockResolvedValue({
        matrix: matrixRow(),
        created: false,
      });
      await service.build({ rfqId: 'rfq-1' }, placement());
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('422 when there are no current-version quotations to compare', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByRfqId.mockResolvedValue([
        quotationRow('q-0', 'ins-1', false),
      ]);
      await expect(
        service.build({ rfqId: 'rfq-1' }, placement()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(mocks.buildOrRebuild).not.toHaveBeenCalled();
    });

    it('422 when a score names an insurer that has no current quote', async () => {
      const { service } = makeDeps();
      await expect(
        service.build(
          {
            rfqId: 'rfq-1',
            scores: [{ insurerId: 'ins-2', serviceScore: '80' }],
          },
          placement(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('does not touch the Opportunity status when it is not QUOTES_RECEIVED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'RECOMMENDATION_DRAFTED',
        insuranceProgramId: 'prog-1',
      });
      await service.build({ rfqId: 'rfq-1' }, placement());
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('still returns the matrix when the best-effort transition throws', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValue(new Error('boom'));
      const view = await service.build({ rfqId: 'rfq-1' }, placement());
      expect(view.id).toBe('cm-1');
    });

    it('404 when the RFQ does not exist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRfqById.mockResolvedValue(null);
      await expect(
        service.build({ rfqId: 'rfq-1' }, placement()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 (no existence oracle) when the customer is not visible', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'someone-else',
      });
      await expect(
        service.build(
          { rfqId: 'rfq-1' },
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('get', () => {
    it('404 when no matrix has been built for the RFQ', async () => {
      const { service, mocks } = makeDeps();
      mocks.findByRfqId.mockResolvedValue(null);
      await expect(service.get('rfq-1', placement())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the matrix with missing / declined recomputed live from the shortlist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findByRfqId.mockResolvedValue(matrixRow());
      const view = await service.get('rfq-1', placement());
      expect(view.missingInsurers.map((i) => i.id)).toEqual(['ins-2']);
      expect(view.declinedInsurers.map((i) => i.id)).toEqual(['ins-3']);
    });

    it('keeps the buckets disjoint when an insurer went DECLINED after the build (stale stored snapshot)', async () => {
      const { service, mocks } = makeDeps();
      // Stored snapshot still lists ins-2 as missing, but the live shortlist
      // now has ins-2 DECLINED.
      mocks.findByRfqId.mockResolvedValue(
        matrixRow({ missingInsurers: ['ins-2'] }),
      );
      mocks.findRfqById.mockResolvedValue({
        ...RFQ_ROW,
        insurerSubmissions: [
          submission('sub-1', 'ins-1', 'QUOTED'),
          submission('sub-2', 'ins-2', 'DECLINED'),
        ],
      });
      const view = await service.get('rfq-1', placement());
      expect(view.missingInsurers).toEqual([]);
      expect(view.declinedInsurers.map((i) => i.id)).toEqual(['ins-2']);
    });
  });

  describe('getById', () => {
    it('404 when the matrix id does not exist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);
      await expect(service.getById('nope', placement())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
