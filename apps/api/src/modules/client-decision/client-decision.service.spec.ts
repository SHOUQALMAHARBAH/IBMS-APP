import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { ClientDecisionService } from './client-decision.service';
import type { ClientDecisionRepository } from '../../repositories/client-decision.repository';
import type { OpportunityRepository } from '../../repositories/opportunity.repository';
import type { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function sales(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
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

function decisionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cd-1',
    opportunityId: 'opp-1',
    decision: 'ACCEPT',
    evidenceType: 'e-signature',
    evidenceRef: 'env-123',
    notes: null,
    capturedByUserId: 'sales-1',
    decidedAt: new Date(),
    opportunity: { id: 'opp-1', customerId: 'cust-1', status: 'PLACEMENT' },
    ...over,
  };
}

const DTO = {
  opportunityId: 'opp-1',
  decision: 'ACCEPT' as const,
  evidenceType: 'e-signature' as const,
  evidenceRef: 'env-123',
};

/** `makeDeps({ startStatus })` wires a **stateful** Opportunity: every
 * `workflow.transition` that resolves moves the mocked Opportunity's status,
 * and `opportunities.findById` returns that live status — so the routing
 * walk (which re-reads before each hop) progresses naturally. */
function makeDeps(opts: { startStatus?: string } = {}) {
  const state = { oppStatus: opts.startStatus ?? 'SENT_TO_CLIENT' };

  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(decisionRow({ ...input, id: 'cd-1' })),
    );
  const findById = vi.fn().mockResolvedValue(decisionRow());
  const findByOpportunityId = vi.fn().mockResolvedValue(null);
  const findManyByCustomerId = vi.fn().mockResolvedValue([decisionRow()]);
  const clientDecisions = {
    create,
    findById,
    findByOpportunityId,
    findManyByCustomerId,
  } as unknown as ClientDecisionRepository;

  const findOpportunityById = vi.fn().mockImplementation(() =>
    Promise.resolve({
      id: 'opp-1',
      customerId: 'cust-1',
      status: state.oppStatus,
    }),
  );
  const opportunities = {
    findById: findOpportunityById,
  } as unknown as OpportunityRepository;

  const findRecommendationByOpportunityId = vi
    .fn()
    .mockResolvedValue({ id: 'rec-1', sentToClientAt: new Date() });
  const recommendations = {
    findByOpportunityId: findRecommendationByOpportunityId,
  } as unknown as RecommendationRepository;

  const findCustomerById = vi
    .fn()
    .mockResolvedValue({ id: 'cust-1', ownerUserId: 'sales-1' });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn<(p: { toStatus: string }) => Promise<unknown>>()
    .mockImplementation((p) => {
      state.oppStatus = p.toStatus;
      return Promise.resolve({ id: 'opp-1', status: p.toStatus });
    });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new ClientDecisionService(
      clientDecisions,
      opportunities,
      recommendations,
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
      findOpportunityById,
      findRecommendationByOpportunityId,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('ClientDecisionService', () => {
  describe('capture', () => {
    it('records the decision, audits CREATE, and walks the Opportunity SENT_TO_CLIENT -> CLIENT_DECISION -> PLACEMENT', async () => {
      const { service, mocks, state } = makeDeps();

      const view = await service.capture(DTO, sales());

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          opportunityId: 'opp-1',
          decision: 'ACCEPT',
          evidenceType: 'e-signature',
          evidenceRef: 'env-123',
          capturedByUserId: 'sales-1',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'ClientDecision',
        }),
      );
      expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
        'CLIENT_DECISION',
        'PLACEMENT',
      ]);
      expect(state.oppStatus).toBe('PLACEMENT');
      expect(view.route).toBe('PLACEMENT');
      expect(view.routeLabel).toBe('Proceed to placement');
      expect(view.routingComplete).toBe(true);
    });

    it('routes REJECT to CLOSED_LOST', async () => {
      const { service, mocks } = makeDeps();
      await service.capture({ ...DTO, decision: 'REJECT' }, sales());
      expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
        'CLIENT_DECISION',
        'CLOSED_LOST',
      ]);
    });

    it('routes every REQUEST_* decision to RENEGOTIATE', async () => {
      for (const decision of [
        'REQUEST_FURTHER_NEGOTIATION',
        'REQUEST_ALTERNATIVE_OPTIONS',
        'REQUEST_PRICE_REDUCTION',
        'REQUEST_COVERAGE_INCREASE',
      ] as const) {
        const { service, mocks } = makeDeps();
        await service.capture({ ...DTO, decision }, sales());
        expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
          'CLIENT_DECISION',
          'RENEGOTIATE',
        ]);
      }
    });

    it('catches up a lagging #16 advance — routes from RECOMMENDATION_DRAFTED through SENT_TO_CLIENT', async () => {
      const { service, mocks, state } = makeDeps({
        startStatus: 'RECOMMENDATION_DRAFTED',
      });
      await service.capture(DTO, sales());
      expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
        'SENT_TO_CLIENT',
        'CLIENT_DECISION',
        'PLACEMENT',
      ]);
      expect(state.oppStatus).toBe('PLACEMENT');
    });

    it('skips a hop another actor already applied (self-healing) rather than aborting the walk', async () => {
      // The Opportunity is already at CLIENT_DECISION when the walk starts.
      const { service, mocks, state } = makeDeps({
        startStatus: 'CLIENT_DECISION',
      });
      await service.capture(DTO, sales());
      expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
        'PLACEMENT',
      ]);
      expect(state.oppStatus).toBe('PLACEMENT');
    });

    it('does not route from an unexpected Opportunity status (still records the decision)', async () => {
      const { service, mocks } = makeDeps({ startStatus: 'QUOTES_RECEIVED' });
      const view = await service.capture(DTO, sales());
      expect(mocks.create).toHaveBeenCalled();
      expect(mocks.transition).not.toHaveBeenCalled();
      expect(view.routingComplete).toBe(false);
    });

    it('still records the decision when a routing transition throws (and stops the walk)', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValue(new Error('boom'));
      const view = await service.capture(DTO, sales());
      expect(view.id).toBe('cd-1');
      // one attempted hop, then it stops — never loops
      expect(mocks.transition).toHaveBeenCalledTimes(1);
    });

    it('422 when no recommendation has been sent to the client', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRecommendationByOpportunityId.mockResolvedValue(null);
      await expect(service.capture(DTO, sales())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when a recommendation exists but was never sent', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRecommendationByOpportunityId.mockResolvedValue({
        id: 'rec-1',
        sentToClientAt: null,
      });
      await expect(service.capture(DTO, sales())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('409 when a decision already exists (pre-check)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findByOpportunityId.mockResolvedValue(decisionRow());
      await expect(service.capture(DTO, sales())).rejects.toThrow(
        ConflictException,
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('409 when the unique index rejects a concurrent insert', async () => {
      const { service, mocks } = makeDeps();
      mocks.create.mockRejectedValue(p2002());
      await expect(service.capture(DTO, sales())).rejects.toThrow(
        ConflictException,
      );
    });

    it('404 (no oracle) when the customer is not visible', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'someone-else',
      });
      await expect(
        service.capture(
          DTO,
          sales({ id: 'sales-2', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list / get', () => {
    it('422 when neither scope is provided', async () => {
      const { service } = makeDeps();
      await expect(service.list({}, sales())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('422 when both scopes are provided', async () => {
      const { service } = makeDeps();
      await expect(
        service.list({ opportunityId: 'opp-1', customerId: 'cust-1' }, sales()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns the single decision for an opportunity scope, with the route', async () => {
      const { service, mocks } = makeDeps();
      mocks.findByOpportunityId.mockResolvedValue(
        decisionRow({
          decision: 'REJECT',
          opportunity: {
            id: 'opp-1',
            customerId: 'cust-1',
            status: 'CLOSED_LOST',
          },
        }),
      );
      const [view] = await service.list({ opportunityId: 'opp-1' }, sales());
      expect(view.route).toBe('CLOSED_LOST');
      expect(view.routingComplete).toBe(true);
    });

    it('resolves customer visibility before a customer-scoped list', async () => {
      const { service, mocks } = makeDeps();
      await service.list({ customerId: 'cust-1' }, sales());
      expect(mocks.findCustomerById).toHaveBeenCalledWith('cust-1');
      expect(mocks.findManyByCustomerId).toHaveBeenCalledWith('cust-1');
    });

    it('get 404s a decision the caller cannot see', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'someone-else',
      });
      await expect(
        service.get(
          'cd-1',
          sales({ id: 'sales-2', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
