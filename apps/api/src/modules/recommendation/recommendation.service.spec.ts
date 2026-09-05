import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RecommendationService } from './recommendation.service';
import type { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { OpportunityRepository } from '../../repositories/opportunity.repository';
import type { QuotationRepository } from '../../repositories/quotation.repository';
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
const manager = placement({
  id: 'mgr-1',
  roles: ['BRANCH_DEPARTMENT_MANAGER'],
});

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const INSURER = {
  id: 'ins-rec',
  name: 'Insurer One',
  nameAr: null,
  financialStrengthRating: 'A-',
};

function quotationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'q-rec',
    rfqId: 'rfq-1',
    insurerId: 'ins-rec',
    versionNumber: 1,
    previousVersionId: null,
    isCurrentVersion: true,
    premium: new Prisma.Decimal('100000.000'),
    currency: 'JOD',
    deductible: null,
    limits: null,
    biPeriodMonths: null,
    liabilityLimit: null,
    exclusions: null,
    conditions: null,
    commissionRatePercent: new Prisma.Decimal('15'),
    negotiationNotes: null,
    receivedAt: new Date(),
    capturedByUserId: 'plc-1',
    insurer: INSURER,
    rfq: {
      id: 'rfq-1',
      opportunityId: 'opp-1',
      insuranceLine: 'Property All Risks',
    },
    ...over,
  };
}

/** A comparable competitor on the same RFQ line: premium within the 10%
 * band, commission 5 pp lower — enough to trip `detectConflictOfInterest`. */
function competitorQuote() {
  return quotationRow({
    id: 'q-cmp',
    insurerId: 'ins-cmp',
    premium: new Prisma.Decimal('104000.000'),
    commissionRatePercent: new Prisma.Decimal('10'),
    insurer: { ...INSURER, id: 'ins-cmp', name: 'Insurer Two' },
  });
}

const FACTORS = {
  coverage: 'Matches every requested peril and the two extensions.',
  price: 'Second-lowest premium; 4% above the cheapest.',
  financialStrength: 'A- rated, adequate for this exposure.',
  claimsService: 'Local adjuster panel, 10-day average settlement.',
  deductible: 'JOD 1,000 — in line with the market for this class.',
  policyConditions: 'No unusual warranties; standard subrogation clause.',
};

const DRAFT_DTO = {
  opportunityId: 'opp-1',
  recommendedQuotationId: 'q-rec',
  rationale: 'Recommend Insurer One on balance of price and service.',
  rationaleFactors: { ...FACTORS },
};

function disclosureRow(over: Record<string, unknown> = {}) {
  return {
    id: 'coi-1',
    recommendationId: 'rec-1',
    competingQuotationId: 'q-cmp',
    commissionDifferencePercent: new Prisma.Decimal('5'),
    disclosureText: 'Disclosed to the client.',
    acknowledgedByUserId: 'cmp-1',
    acknowledgedAt: new Date(),
    ...over,
  };
}

function recommendationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    opportunityId: 'opp-1',
    recommendedQuotationId: 'q-rec',
    rationale: DRAFT_DTO.rationale,
    rationaleFactors: { ...FACTORS },
    draftedByUserId: 'plc-1',
    approvalRequired: false,
    conflictOfInterestFlagged: false,
    coiCompetingQuotationId: null,
    coiCommissionDiffPercent: null,
    approvedByUserId: null,
    approvedAt: null,
    sentToClientAt: null,
    sentByUserId: null,
    createdAt: new Date(),
    recommendedQuotation: quotationRow(),
    conflictOfInterestDisclosure: null,
    opportunity: {
      id: 'opp-1',
      customerId: 'cust-1',
      status: 'COMPARISON_BUILT',
      targetPremiumThreshold: null,
    },
    ...over,
  };
}

function makeDeps() {
  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(recommendationRow({ ...input, id: 'rec-1' })),
    );
  const findById = vi.fn().mockResolvedValue(recommendationRow());
  const findByOpportunityId = vi.fn().mockResolvedValue(recommendationRow());
  const findManyByCustomerId = vi.fn().mockResolvedValue([recommendationRow()]);
  const recordApproval = vi
    .fn()
    .mockResolvedValue(recommendationRow({ approvedByUserId: 'mgr-1' }));
  const recordSent = vi
    .fn()
    .mockResolvedValue(recommendationRow({ sentToClientAt: new Date() }));
  const createDisclosure = vi.fn().mockResolvedValue({ id: 'coi-1' });
  const recommendations = {
    create,
    findById,
    findByOpportunityId,
    findManyByCustomerId,
    recordApproval,
    recordSent,
    createDisclosure,
  } as unknown as RecommendationRepository;

  const findOpportunityById = vi.fn().mockResolvedValue({
    id: 'opp-1',
    customerId: 'cust-1',
    status: 'COMPARISON_BUILT',
    targetPremiumThreshold: null,
  });
  const opportunities = {
    findById: findOpportunityById,
  } as unknown as OpportunityRepository;

  const findQuotationById = vi.fn().mockResolvedValue(quotationRow());
  // Default: only the recommended quote is on the RFQ line — no competitor,
  // so nothing is COI-flagged unless a test supplies one.
  const findManyByRfqId = vi.fn().mockResolvedValue([quotationRow()]);
  const quotations = {
    findById: findQuotationById,
    findManyByRfqId,
  } as unknown as QuotationRepository;

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
      (params: { entityType: string; toStatus: string }) => Promise<unknown>
    >()
    .mockResolvedValue({ id: 'opp-1', status: 'RECOMMENDATION_DRAFTED' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new RecommendationService(
      recommendations,
      opportunities,
      quotations,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      create,
      findById,
      findByOpportunityId,
      findManyByCustomerId,
      recordApproval,
      recordSent,
      createDisclosure,
      findOpportunityById,
      findQuotationById,
      findManyByRfqId,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('RecommendationService', () => {
  describe('draft', () => {
    it('drafts, snapshots the gate flags, audits CREATE, and best-effort advances the Opportunity', async () => {
      const { service, mocks } = makeDeps();
      // A comparable competitor on the RFQ line trips the COI check.
      mocks.findManyByRfqId.mockResolvedValue([
        quotationRow(),
        competitorQuote(),
      ]);
      // The view is re-read after the write — reflect the snapshot.
      mocks.findById.mockResolvedValue(
        recommendationRow({
          conflictOfInterestFlagged: true,
          coiCompetingQuotationId: 'q-cmp',
        }),
      );
      const view = await service.draft(DRAFT_DTO, placement());

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          opportunityId: 'opp-1',
          recommendedQuotationId: 'q-rec',
          draftedByUserId: 'plc-1',
          approvalRequired: false,
          conflictOfInterestFlagged: true, // q-cmp: comparable, 5pp lower commission
          coiCompetingQuotationId: 'q-cmp',
        }),
      );
      expect(view.conflictOfInterestFlagged).toBe(true);
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'Recommendation',
        }),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Opportunity',
          toStatus: 'RECOMMENDATION_DRAFTED',
        }),
      );
    });

    it('marks approvalRequired when the premium exceeds the target threshold', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'COMPARISON_BUILT',
        targetPremiumThreshold: new Prisma.Decimal('90000.000'),
      });
      await service.draft(DRAFT_DTO, placement());
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ approvalRequired: true }),
      );
    });

    it('422 when the Opportunity is not at COMPARISON_BUILT', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'RFQ_ISSUED',
        targetPremiumThreshold: null,
      });
      await expect(service.draft(DRAFT_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when the recommended quotation is not on the Opportunity', async () => {
      const { service, mocks } = makeDeps();
      mocks.findQuotationById.mockResolvedValue(
        quotationRow({
          rfq: { id: 'rfq-9', opportunityId: 'opp-other', insuranceLine: 'X' },
        }),
      );
      await expect(service.draft(DRAFT_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when the recommended quotation is a superseded version', async () => {
      const { service, mocks } = makeDeps();
      mocks.findQuotationById.mockResolvedValue(
        quotationRow({ isCurrentVersion: false }),
      );
      await expect(service.draft(DRAFT_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('409 when a recommendation already exists (unique violation)', async () => {
      const { service, mocks } = makeDeps();
      mocks.create.mockRejectedValue(p2002());
      await expect(service.draft(DRAFT_DTO, placement())).rejects.toThrow(
        ConflictException,
      );
    });

    it('still returns the draft when the best-effort transition throws', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValue(new Error('boom'));
      const view = await service.draft(DRAFT_DTO, placement());
      expect(view.id).toBe('rec-1');
    });

    it('404 (no oracle) when the customer is not visible', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'someone-else',
      });
      await expect(
        service.draft(
          DRAFT_DTO,
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('approve', () => {
    it('422 when the recommendation needs no approval', async () => {
      const { service } = makeDeps();
      await expect(service.approve('rec-1', manager)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('403 when the approver is the drafter (maker/checker)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ approvalRequired: true, draftedByUserId: 'mgr-1' }),
      );
      await expect(service.approve('rec-1', manager)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('stamps the approval and audits UPDATE', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ approvalRequired: true }),
      );
      await service.approve('rec-1', manager);
      expect(mocks.recordApproval).toHaveBeenCalledWith('rec-1', 'mgr-1');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('409 when already approved', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({
          approvalRequired: true,
          approvedByUserId: 'mgr-2',
          approvedAt: new Date(),
        }),
      );
      await expect(service.approve('rec-1', manager)).rejects.toThrow(
        ConflictException,
      );
    });

    it('409 when the conditional write matched nothing (concurrent approve)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ approvalRequired: true }),
      );
      mocks.recordApproval.mockResolvedValue(null);
      await expect(service.approve('rec-1', manager)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('discloseConflictOfInterest', () => {
    const DTO = {
      disclosureText:
        'Insurer One pays the broker 5 percentage points more commission than the comparable Insurer Two quote; disclosed to the client on 2026-09-01.',
    };
    const complianceActor = placement({
      id: 'cmp-1',
      roles: ['COMPLIANCE_OFFICER'],
    });

    it('422 when the recommendation was not flagged', async () => {
      const { service } = makeDeps();
      await expect(
        service.discloseConflictOfInterest('rec-1', DTO, complianceActor),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('403 when the acknowledger is the drafter', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({
          conflictOfInterestFlagged: true,
          coiCompetingQuotationId: 'q-cmp',
        }),
      );
      await expect(
        service.discloseConflictOfInterest('rec-1', DTO, placement()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records the disclosure against the detected competitor and audits CREATE', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({
          conflictOfInterestFlagged: true,
          coiCompetingQuotationId: 'q-cmp',
          coiCommissionDiffPercent: new Prisma.Decimal('5'),
        }),
      );
      await service.discloseConflictOfInterest('rec-1', DTO, complianceActor);
      expect(mocks.createDisclosure).toHaveBeenCalledWith(
        expect.objectContaining({
          recommendationId: 'rec-1',
          competingQuotationId: 'q-cmp',
          acknowledgedByUserId: 'cmp-1',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'ConflictOfInterestDisclosure',
        }),
      );
    });

    it('409 when a disclosure already exists', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({
          conflictOfInterestFlagged: true,
          conflictOfInterestDisclosure: disclosureRow({ id: 'coi-0' }),
        }),
      );
      await expect(
        service.discloseConflictOfInterest('rec-1', DTO, complianceActor),
      ).rejects.toThrow(ConflictException);
    });

    it('422 on an override competingQuotationId that is not a current quote on the Opportunity', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({
          conflictOfInterestFlagged: true,
          coiCompetingQuotationId: 'q-cmp',
        }),
      );
      mocks.findQuotationById.mockResolvedValue(
        quotationRow({
          id: 'q-elsewhere',
          rfq: { id: 'r', opportunityId: 'opp-x', insuranceLine: 'Y' },
        }),
      );
      await expect(
        service.discloseConflictOfInterest(
          'rec-1',
          { ...DTO, competingQuotationId: 'q-elsewhere' },
          complianceActor,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('send', () => {
    it('409 when already sent', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ sentToClientAt: new Date() }),
      );
      await expect(service.send('rec-1', placement())).rejects.toThrow(
        ConflictException,
      );
    });

    it('422 when a required approval is missing', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ approvalRequired: true }),
      );
      await expect(service.send('rec-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when a required COI disclosure is missing', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ conflictOfInterestFlagged: true }),
      );
      await expect(service.send('rec-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('sends when all gates are clear and advances the Opportunity', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({
          approvalRequired: true,
          approvedAt: new Date(),
          approvedByUserId: 'mgr-1',
          conflictOfInterestFlagged: true,
          conflictOfInterestDisclosure: disclosureRow(),
          // `send` reads status + threshold straight off the loaded rec now.
          opportunity: {
            id: 'opp-1',
            customerId: 'cust-1',
            status: 'RECOMMENDATION_DRAFTED',
            targetPremiumThreshold: new Prisma.Decimal('90000.000'),
          },
        }),
      );
      await service.send('rec-1', placement());
      expect(mocks.recordSent).toHaveBeenCalledWith('rec-1', 'plc-1');
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'SENT_TO_CLIENT' }),
      );
    });

    it('re-derives the send-gates from live data — a threshold set after draft still blocks', async () => {
      const { service, mocks } = makeDeps();
      // Snapshot says no approval needed, but the Opportunity now carries a
      // threshold below the recommended premium (100000).
      mocks.findById.mockResolvedValue(
        recommendationRow({
          approvalRequired: false,
          opportunity: {
            id: 'opp-1',
            customerId: 'cust-1',
            status: 'RECOMMENDATION_DRAFTED',
            targetPremiumThreshold: new Prisma.Decimal('50000.000'),
          },
        }),
      );
      await expect(service.send('rec-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.recordSent).not.toHaveBeenCalled();
    });

    it('re-derives the COI gate from live data — a comparable competitor quoting after draft still blocks', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(
        recommendationRow({ conflictOfInterestFlagged: false }),
      );
      // A comparable low-commission competitor has since landed on the line.
      mocks.findManyByRfqId.mockResolvedValue([
        quotationRow(),
        competitorQuote(),
      ]);
      await expect(service.send('rec-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.recordSent).not.toHaveBeenCalled();
    });

    it('409 when the conditional send write matched nothing', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(recommendationRow());
      mocks.recordSent.mockResolvedValue(null);
      await expect(service.send('rec-1', placement())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('list / get', () => {
    it('422 when neither scope is provided', async () => {
      const { service } = makeDeps();
      await expect(service.list({}, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('returns the single recommendation for an opportunity scope', async () => {
      const { service } = makeDeps();
      const out = await service.list({ opportunityId: 'opp-1' }, placement());
      expect(out).toHaveLength(1);
      expect(out[0].opportunityId).toBe('opp-1');
    });

    it('get 404s a recommendation the caller cannot see', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'someone-else',
      });
      await expect(
        service.get(
          'rec-1',
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
