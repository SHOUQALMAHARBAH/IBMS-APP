import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PolicyService } from './policy.service';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { OpportunityRepository } from '../../repositories/opportunity.repository';
import type { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { ClientDecisionRepository } from '../../repositories/client-decision.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PlacePolicyDto } from './dto/place-policy.dto';
import type { RecordPolicyIssuanceDto } from './dto/record-policy-issuance.dto';

function placement(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'plc-1',
    email: 'plc@ibms.test',
    roles: ['PLACEMENT_TECHNICAL_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

/** A Sales officer is NOT in CUSTOMER_FILE_CROSS_OWNER_ROLES, so visibility
 * is scoped to Customers they own — used to exercise the not-visible branch
 * (a Placement officer can reach the whole book). */
function sales(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-2',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-2',
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const PLACE_DTO: PlacePolicyDto = {
  opportunityId: 'opp-1',
  inceptionDate: '2026-10-01',
};

const ISSUANCE_DTO = {
  policyNumber: 'POL-2026-001',
  issuedPremium: '119000.000',
  schedule: {
    limits: { buildings: '5000000' },
    sumsInsured: { total: '5000000' },
  },
  documents: [
    {
      category: 'POLICY',
      classification: 'CONFIDENTIAL',
      fileName: 'wording.pdf',
      storageRef: 's3://bucket/wording.pdf',
    },
  ],
} as unknown as RecordPolicyIssuanceDto;

interface Opts {
  policyStatus?: string;
  existingPolicy?: unknown;
  decision?: unknown; // undefined -> ACCEPT; null -> none
  scheduleOpen?: boolean;
  transitionRejects?: boolean;
  artifactsReject?: boolean;
  customerOwner?: string;
}

function makeDeps(opts: Opts = {}) {
  const state = {
    status: opts.policyStatus ?? 'PLACEMENT_CONFIRMED',
    policyNumber: null as string | null,
    issuedPremium: null as Prisma.Decimal | null,
    schedules: (opts.scheduleOpen
      ? [{ id: 'sch-0', effectiveTo: null }]
      : []) as { id: string; effectiveTo: Date | null }[],
  };

  const policyRow = () => ({
    id: 'pol-1',
    opportunityId: 'opp-1',
    customerId: 'cust-1',
    insurerId: 'ins-1',
    insurer: { id: 'ins-1', name: 'Insurer 1', nameAr: null },
    policyNumber: state.policyNumber,
    insuranceLine: 'Property All Risks',
    status: state.status,
    inceptionDate: new Date('2026-10-01T00:00:00Z'),
    expiryDate: null,
    requestedPremium: new Prisma.Decimal('120000'),
    issuedPremium: state.issuedPremium,
    currency: 'JOD',
    placedByUserId: 'plc-1',
    issuedByUserId: state.issuedPremium ? 'plc-1' : null,
    schedules: state.schedules,
    documents: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ id: 'pol-1', status: 'PLACEMENT_CONFIRMED', ...input }),
    );
  const findById = vi
    .fn()
    .mockImplementation(() => Promise.resolve(policyRow()));
  const findByOpportunityId = vi
    .fn()
    .mockResolvedValue(opts.existingPolicy ?? null);
  const findManyByCustomerId = vi.fn().mockResolvedValue([policyRow()]);
  const createIssuanceArtifacts = vi
    .fn()
    .mockImplementation(
      (
        policyId: string,
        schedule: Record<string, unknown>,
        docs: Record<string, unknown>[],
      ) => {
        if (opts.artifactsReject) return Promise.reject(p2002());
        const s = {
          id: 'sch-1',
          policyId,
          effectiveFrom: schedule.effectiveFrom,
          effectiveTo: null,
          limits: schedule.limits,
          sumsInsured: schedule.sumsInsured,
          namedPerils: schedule.namedPerils,
          extensions: schedule.extensions,
          sourceEndorsementId: null,
          createdAt: new Date(),
        };
        state.schedules = [{ id: 'sch-1', effectiveTo: null }];
        return Promise.resolve({
          schedule: s,
          documents: docs.map((d, i) => ({
            id: `doc-${i}`,
            policyId,
            ...d,
            versionNumber: 1,
            previousVersionId: null,
            createdAt: new Date(),
          })),
        });
      },
    );
  const attachDocuments = vi
    .fn()
    .mockImplementation((policyId: string, docs: Record<string, unknown>[]) =>
      Promise.resolve(
        docs.map((d, i) => ({
          id: `doc-${i}`,
          policyId,
          ...d,
          versionNumber: 1,
          previousVersionId: null,
          createdAt: new Date(),
        })),
      ),
    );
  const policies = {
    create,
    findById,
    findByOpportunityId,
    findManyByCustomerId,
    createIssuanceArtifacts,
    attachDocuments,
  } as unknown as PolicyRepository;

  const findOpportunityById = vi.fn().mockResolvedValue({
    id: 'opp-1',
    customerId: 'cust-1',
    status: 'PLACEMENT',
  });
  const opportunities = {
    findById: findOpportunityById,
  } as unknown as OpportunityRepository;

  const findRecommendationByOpportunityId = vi.fn().mockResolvedValue({
    id: 'rec-1',
    sentToClientAt: new Date(),
    recommendedQuotation: {
      id: 'q-1',
      insurerId: 'ins-1',
      premium: new Prisma.Decimal('120000'),
      currency: 'JOD',
      rfq: {
        id: 'rfq-1',
        insuranceLine: 'Property All Risks',
        opportunityId: 'opp-1',
      },
    },
  });
  const recommendations = {
    findByOpportunityId: findRecommendationByOpportunityId,
  } as unknown as RecommendationRepository;

  const findClientDecisionByOpportunityId = vi
    .fn()
    .mockResolvedValue(
      opts.decision === undefined ? { decision: 'ACCEPT' } : opts.decision,
    );
  const clientDecisions = {
    findByOpportunityId: findClientDecisionByOpportunityId,
  } as unknown as ClientDecisionRepository;

  const findCustomerById = vi.fn().mockResolvedValue({
    id: 'cust-1',
    ownerUserId: opts.customerOwner ?? 'plc-1',
  });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi
    .fn<
      (input: {
        userId: string;
        action: string;
        entityType: string;
        entityId: string;
      }) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn<
      (p: {
        toStatus: string;
        data?: Record<string, unknown>;
      }) => Promise<unknown>
    >()
    .mockImplementation((p) => {
      if (opts.transitionRejects) {
        return Promise.reject(
          new ConflictException('status changed concurrently'),
        );
      }
      state.status = p.toStatus;
      if (p.data?.policyNumber)
        state.policyNumber = p.data.policyNumber as string;
      if (p.data?.issuedPremium)
        state.issuedPremium = p.data.issuedPremium as Prisma.Decimal;
      return Promise.resolve({ id: 'pol-1', status: p.toStatus });
    });
  const workflow = {
    transition,
  } as unknown as WorkflowTransitionService;

  return {
    service: new PolicyService(
      policies,
      opportunities,
      recommendations,
      clientDecisions,
      customers,
      audit,
      workflow,
    ),
    state,
    mocks: {
      create,
      findById,
      findByOpportunityId,
      findManyByCustomerId,
      createIssuanceArtifacts,
      attachDocuments,
      findOpportunityById,
      findRecommendationByOpportunityId,
      findClientDecisionByOpportunityId,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('PolicyService', () => {
  describe('place', () => {
    it('creates the policy from the accepted recommendation and audits CREATE', async () => {
      const { service, mocks } = makeDeps();

      const view = await service.place(PLACE_DTO, placement());

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          opportunityId: 'opp-1',
          customerId: 'cust-1',
          insurerId: 'ins-1',
          insuranceLine: 'Property All Risks',
          currency: 'JOD',
          placedByUserId: 'plc-1',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Policy' }),
      );
      expect(view.status).toBe('PLACEMENT_CONFIRMED');
      // requested premium taken from the recommended quotation, fils-quantized
      expect(view.requestedPremium).toBe('120000.000');
      expect(view.premiumVariance).toBeNull();
    });

    it('422 when the Opportunity has no ACCEPT client decision', async () => {
      const { service } = makeDeps({ decision: null });
      await expect(service.place(PLACE_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when the client decision is not ACCEPT', async () => {
      const { service } = makeDeps({ decision: { decision: 'REJECT' } });
      await expect(service.place(PLACE_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('409 when a Policy already exists (pre-check)', async () => {
      const { service, mocks } = makeDeps({
        existingPolicy: { id: 'pol-existing', policyNumber: 'POL-9' },
      });
      await expect(service.place(PLACE_DTO, placement())).rejects.toThrow(
        ConflictException,
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('409 when the unique index rejects a concurrent insert', async () => {
      const { service, mocks } = makeDeps();
      mocks.create.mockRejectedValueOnce(p2002());
      await expect(service.place(PLACE_DTO, placement())).rejects.toThrow(
        ConflictException,
      );
    });

    it('422 when expiryDate is not after inceptionDate', async () => {
      const { service } = makeDeps();
      await expect(
        service.place(
          {
            opportunityId: 'opp-1',
            inceptionDate: '2026-10-01',
            expiryDate: '2026-09-01',
          },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('404 (no oracle) when the Opportunity customer is not visible to the caller', async () => {
      const { service } = makeDeps({ customerOwner: 'someone-else' });
      await expect(service.place(PLACE_DTO, sales())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recordIssuance', () => {
    it('transitions PLACEMENT_CONFIRMED -> ISSUED with the issued scalars as data, then creates the schedule + documents', async () => {
      const { service, mocks, state } = makeDeps();

      const view = await service.recordIssuance(
        'pol-1',
        ISSUANCE_DTO,
        placement(),
      );

      // the status flip is the engine's transition call; the issued scalars
      // ride the SAME call as its `data` (one atomic, engine-audited write) —
      // the view assertions below confirm they actually persisted.
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Policy',
          entityId: 'pol-1',
          toStatus: 'ISSUED',
        }),
      );
      expect(mocks.createIssuanceArtifacts).toHaveBeenCalledTimes(1);
      expect(state.status).toBe('ISSUED');
      // audit: the issuance UPDATE + the schedule CREATE + one document CREATE
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'Policy' }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'PolicySchedule',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Document' }),
      );
      expect(view.status).toBe('ISSUED');
      expect(view.issuedPremium).toBe('119000.000');
      expect(view.premiumVariance).toBe('-1000.000');
      expect(view.issuanceComplete).toBe(true);
    });

    it('422 when the issued premium is negative', async () => {
      const { service } = makeDeps();
      await expect(
        service.recordIssuance(
          'pol-1',
          { ...ISSUANCE_DTO, issuedPremium: '-5' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('422 when limits is an empty object', async () => {
      const { service } = makeDeps();
      await expect(
        service.recordIssuance(
          'pol-1',
          {
            ...ISSUANCE_DTO,
            schedule: { limits: {}, sumsInsured: { total: '1' } },
          },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('422 when an inception-date override is pushed past the policy period already stored (no expiry override)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'pol-1',
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        insurerId: 'ins-1',
        insurer: { id: 'ins-1', name: 'Insurer 1', nameAr: null },
        policyNumber: null,
        insuranceLine: 'Property All Risks',
        status: 'PLACEMENT_CONFIRMED',
        inceptionDate: new Date('2026-10-01T00:00:00Z'),
        expiryDate: new Date('2027-10-01T00:00:00Z'),
        requestedPremium: new Prisma.Decimal('120000'),
        issuedPremium: null,
        currency: 'JOD',
        placedByUserId: 'plc-1',
        issuedByUserId: null,
        schedules: [],
        documents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        service.recordIssuance(
          'pol-1',
          { ...ISSUANCE_DTO, inceptionDate: '2028-01-01' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('422 when the policy is past PLACEMENT_CONFIRMED and not a resumable partial issuance', async () => {
      const { service, mocks } = makeDeps({ policyStatus: 'VERIFIED' });
      await expect(
        service.recordIssuance('pol-1', ISSUANCE_DTO, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.transition).not.toHaveBeenCalled();
      expect(mocks.createIssuanceArtifacts).not.toHaveBeenCalled();
    });

    it('resumes a partially-completed issuance (ISSUED, no open schedule, matching payload) without re-transitioning', async () => {
      const { service, mocks } = makeDeps({ policyStatus: 'ISSUED' });
      // the prior attempt persisted the scalars
      mocks.findById.mockResolvedValue({
        id: 'pol-1',
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        insurerId: 'ins-1',
        insurer: { id: 'ins-1', name: 'Insurer 1', nameAr: null },
        policyNumber: 'POL-2026-001',
        insuranceLine: 'Property All Risks',
        status: 'ISSUED',
        inceptionDate: new Date('2026-10-01T00:00:00Z'),
        expiryDate: null,
        requestedPremium: new Prisma.Decimal('120000'),
        issuedPremium: new Prisma.Decimal('119000.000'),
        currency: 'JOD',
        placedByUserId: 'plc-1',
        issuedByUserId: 'plc-1',
        schedules: [],
        documents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.recordIssuance('pol-1', ISSUANCE_DTO, placement());

      expect(mocks.transition).not.toHaveBeenCalled();
      expect(mocks.createIssuanceArtifacts).toHaveBeenCalledTimes(1);
    });

    it('422 (not a resume) when the policy is ISSUED with no open schedule but the retry payload does not match the recorded issuance', async () => {
      const issuedRow = (over: Record<string, unknown>) => ({
        id: 'pol-1',
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        insurerId: 'ins-1',
        insurer: { id: 'ins-1', name: 'Insurer 1', nameAr: null },
        policyNumber: 'POL-2026-001',
        insuranceLine: 'Property All Risks',
        status: 'ISSUED',
        inceptionDate: new Date('2026-10-01T00:00:00Z'),
        expiryDate: null,
        requestedPremium: new Prisma.Decimal('120000'),
        issuedPremium: new Prisma.Decimal('119000.000'),
        currency: 'JOD',
        placedByUserId: 'plc-1',
        issuedByUserId: 'plc-1',
        schedules: [],
        documents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      });

      // wrong policy number
      const a = makeDeps({ policyStatus: 'ISSUED' });
      a.mocks.findById.mockResolvedValue(
        issuedRow({ policyNumber: 'POL-OTHER' }),
      );
      await expect(
        a.service.recordIssuance('pol-1', ISSUANCE_DTO, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(a.mocks.transition).not.toHaveBeenCalled();
      expect(a.mocks.createIssuanceArtifacts).not.toHaveBeenCalled();

      // wrong issued premium
      const b = makeDeps({ policyStatus: 'ISSUED' });
      b.mocks.findById.mockResolvedValue(
        issuedRow({ issuedPremium: new Prisma.Decimal('100000.000') }),
      );
      await expect(
        b.service.recordIssuance('pol-1', ISSUANCE_DTO, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(b.mocks.createIssuanceArtifacts).not.toHaveBeenCalled();
    });

    it('409 when the workflow transition loses the race (concurrent issuance)', async () => {
      const { service, mocks } = makeDeps({ transitionRejects: true });
      await expect(
        service.recordIssuance('pol-1', ISSUANCE_DTO, placement()),
      ).rejects.toThrow(ConflictException);
      expect(mocks.createIssuanceArtifacts).not.toHaveBeenCalled();
    });

    it('409 when the artefact transaction hits the one-open-schedule partial unique index', async () => {
      const { service } = makeDeps({ artifactsReject: true });
      await expect(
        service.recordIssuance('pol-1', ISSUANCE_DTO, placement()),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a policyNumber unique violation on the transition to 409', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValueOnce(p2002());
      await expect(
        service.recordIssuance('pol-1', ISSUANCE_DTO, placement()),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('attachDocuments', () => {
    it('creates the documents and audits one CREATE Document each', async () => {
      const { service, mocks } = makeDeps();
      await service.attachDocuments(
        'pol-1',
        {
          documents: [
            {
              category: 'INVOICE',
              classification: 'CONFIDENTIAL',
              fileName: 'invoice.pdf',
              storageRef: 's3://bucket/invoice.pdf',
            },
          ],
        },
        placement(),
      );
      expect(mocks.attachDocuments).toHaveBeenCalledTimes(1);
      expect(
        mocks.record.mock.calls.filter(
          (c) => c[0].entityType === 'Document' && c[0].action === 'CREATE',
        ),
      ).toHaveLength(1);
    });
  });

  describe('list / get', () => {
    it('422 when neither scope is provided', async () => {
      const { service } = makeDeps();
      await expect(service.list({}, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when both scopes are provided', async () => {
      const { service } = makeDeps();
      await expect(
        service.list(
          { opportunityId: 'opp-1', customerId: 'cust-1' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns [] for an opportunity scope with no policy yet', async () => {
      const { service, mocks } = makeDeps();
      mocks.findByOpportunityId.mockResolvedValue(null);
      const rows = await service.list({ opportunityId: 'opp-1' }, placement());
      expect(rows).toEqual([]);
    });

    it('returns the policy for an opportunity scope', async () => {
      const { service, mocks } = makeDeps();
      mocks.findByOpportunityId.mockResolvedValue({
        id: 'pol-1',
        opportunityId: 'opp-1',
        customerId: 'cust-1',
        insurerId: 'ins-1',
        insurer: { id: 'ins-1', name: 'Insurer 1', nameAr: null },
        policyNumber: null,
        insuranceLine: 'Property All Risks',
        status: 'PLACEMENT_CONFIRMED',
        inceptionDate: new Date('2026-10-01T00:00:00Z'),
        expiryDate: null,
        requestedPremium: new Prisma.Decimal('120000'),
        issuedPremium: null,
        currency: 'JOD',
        placedByUserId: 'plc-1',
        issuedByUserId: null,
        schedules: [],
        documents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const [view] = await service.list(
        { opportunityId: 'opp-1' },
        placement(),
      );
      expect(view.id).toBe('pol-1');
      expect(view.issuanceComplete).toBe(false);
    });

    it('resolves customer visibility before a customer-scoped list', async () => {
      const { service, mocks } = makeDeps();
      await service.list({ customerId: 'cust-1' }, placement());
      expect(mocks.findCustomerById).toHaveBeenCalledWith('cust-1');
      expect(mocks.findManyByCustomerId).toHaveBeenCalledWith('cust-1');
    });

    it('get 404s a policy the caller cannot see', async () => {
      const { service } = makeDeps({ customerOwner: 'someone-else' });
      await expect(service.get('pol-1', sales())).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
