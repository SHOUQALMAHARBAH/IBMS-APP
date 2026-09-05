import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { EndorsementService } from './endorsement.service';
import type { EndorsementRepository } from '../../repositories/endorsement.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const DAY = 86_400_000;
const INCEPTION = new Date('2026-01-01T00:00:00.000Z');
const EXPIRY = new Date(INCEPTION.getTime() + 360 * DAY);

function placement(over?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'placement-1',
    email: 'placement@ibms.test',
    roles: ['PLACEMENT_TECHNICAL_OFFICER'],
    sessionId: 'session-1',
    ...over,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

interface DepsOpts {
  policyStatus?: string;
  issuedPremium?: string | null;
  commissionRate?: string | null;
  ownerUserId?: string;
}

interface MockEndo {
  id: string;
  policyId: string;
  type: string;
  changeType: string;
  status: string;
  premiumAdjustment: Prisma.Decimal;
  effectiveFrom: Date;
  requestedByUserId: string;
  submittedToInsurerAt: Date | null;
  insurerConfirmedAt: Date | null;
  financialAdjustmentCalculatedAt: Date | null;
  appliedAt: Date | null;
  clientNotifiedAt: Date | null;
  targetCoverage: unknown;
  createdAt: Date;
  cancellation: Record<string, unknown> | null;
  refund: Record<string, unknown> | null;
  commissionReversal: Record<string, unknown> | null;
  schedule: Record<string, unknown> | null;
}

/** A stateful Endorsement + Policy: `workflow.transition` mutates the mocked
 * endorsement's `status` (and the policy's, for a cancellation), and
 * `endorsements.findById` / `policies.findById` return the live rows so the
 * multi-step lifecycle progresses naturally across a single call. */
function makeDeps(opts: DepsOpts = {}) {
  const policyState = {
    id: 'pol-1',
    customerId: 'cust-1',
    status: opts.policyStatus ?? 'ACTIVE',
    opportunityId: 'opp-1',
    issuedPremium:
      opts.issuedPremium === null
        ? null
        : new Prisma.Decimal(opts.issuedPremium ?? '1200.000'),
    inceptionDate: opts.issuedPremium === null ? null : INCEPTION,
    expiryDate: opts.issuedPremium === null ? null : EXPIRY,
    schedules: [
      {
        id: 'sched-1',
        effectiveFrom: INCEPTION,
        effectiveTo: null as Date | null,
      },
    ],
  };

  const endo: MockEndo = {
    id: 'end-1',
    policyId: 'pol-1',
    type: 'POSITIVE',
    changeType: 'coverage_amendment',
    status: 'REQUESTED',
    premiumAdjustment: new Prisma.Decimal('0.000'),
    effectiveFrom: new Date('2026-06-30T00:00:00.000Z'),
    requestedByUserId: 'placement-1',
    submittedToInsurerAt: null,
    insurerConfirmedAt: null,
    financialAdjustmentCalculatedAt: null,
    appliedAt: null,
    clientNotifiedAt: null,
    targetCoverage: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    cancellation: null,
    refund: null,
    commissionReversal: null,
    schedule: null,
  };

  const snapshot = () => ({
    ...endo,
    cancellation: endo.cancellation ? { ...endo.cancellation } : null,
    refund: endo.refund ? { ...endo.refund } : null,
    commissionReversal: endo.commissionReversal
      ? { ...endo.commissionReversal }
      : null,
    schedule: endo.schedule ? { ...endo.schedule } : null,
    policy: {
      id: 'pol-1',
      customerId: 'cust-1',
      status: policyState.status,
      opportunityId: 'opp-1',
    },
  });

  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) => {
      Object.assign(endo, input, { status: 'REQUESTED' });
      return Promise.resolve(snapshot());
    });

  const createCancellationEndorsement = vi
    .fn()
    .mockImplementation(
      (e: Record<string, unknown>, c: Record<string, unknown>) => {
        Object.assign(endo, e, { status: 'REQUESTED' });
        endo.cancellation = {
          id: 'canc-1',
          endorsementId: 'end-1',
          reason: c.reason,
          basis: c.basis,
          returnPremium: c.returnPremium,
          clientNotifiedAt: null,
        };
        return Promise.resolve({
          endorsement: snapshot(),
          cancellation: { ...endo.cancellation },
        });
      },
    );

  const createRefundAndReversal = vi
    .fn()
    .mockImplementation(
      (refund: Record<string, unknown>, reversal: Record<string, unknown>) => {
        endo.refund = {
          id: 'ref-1',
          endorsementId: 'end-1',
          amount: refund.amount,
          reason: refund.reason,
          raisedByUserId: refund.raisedByUserId,
          approvedByUserId: null,
          approvalThresholdMatrixLevel: refund.approvalThresholdMatrixLevel,
          paidAt: null,
        };
        endo.commissionReversal = {
          id: 'cr-1',
          endorsementId: 'end-1',
          amount: reversal.amount,
        };
        return Promise.resolve();
      },
    );
  const findLiveCancellation = vi.fn().mockResolvedValue(null);

  const findById = vi
    .fn()
    .mockImplementation(() => Promise.resolve(snapshot()));
  const findRefundById = vi
    .fn()
    .mockImplementation(() =>
      endo.refund
        ? Promise.resolve({ ...endo.refund, endorsement: snapshot() })
        : Promise.resolve(null),
    );
  const findManyByPolicyId = vi
    .fn()
    .mockImplementation(() => Promise.resolve([snapshot()]));
  const updatePremiumAdjustment = vi
    .fn()
    .mockImplementation((_id: string, pa: Prisma.Decimal) => {
      endo.premiumAdjustment = pa;
      return Promise.resolve(snapshot());
    });
  const recordRefundApproval = vi
    .fn()
    .mockImplementation((_id: string, uid: string) => {
      const r = endo.refund;
      if (!r || r.approvedByUserId) return Promise.resolve(null);
      r.approvedByUserId = uid;
      r.approvalThresholdMatrixLevel = 'approved';
      return Promise.resolve({ ...r });
    });
  const stampCancellationClientNotified = vi.fn().mockImplementation(() => {
    if (endo.cancellation) endo.cancellation.clientNotifiedAt = new Date();
    return Promise.resolve({ ...endo.cancellation });
  });

  const endorsements = {
    create,
    createCancellationEndorsement,
    createRefundAndReversal,
    findLiveCancellation,
    findById,
    findRefundById,
    findManyByPolicyId,
    updatePremiumAdjustment,
    recordRefundApproval,
    stampCancellationClientNotified,
  } as unknown as EndorsementRepository;

  const scheduleForEndorsement = vi
    .fn()
    .mockImplementation(() => Promise.resolve(endo.schedule));
  const versionScheduleForEndorsement = vi
    .fn()
    .mockImplementation((input: { isCancellation: boolean }) => {
      if (input.isCancellation) return Promise.resolve(null);
      endo.schedule = {
        id: 'sched-2',
        policyId: 'pol-1',
        effectiveFrom: new Date('2026-06-30T00:00:00.000Z'),
        sourceEndorsementId: 'end-1',
      };
      return Promise.resolve({ ...endo.schedule });
    });
  const policies = {
    findById: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ ...policyState })),
    findStatus: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ id: 'pol-1', status: policyState.status }),
      ),
    scheduleForEndorsement,
    versionScheduleForEndorsement,
  } as unknown as PolicyRepository;

  const findByOpportunityId = vi.fn().mockImplementation(() =>
    Promise.resolve({
      recommendedQuotation: {
        commissionRatePercent:
          opts.commissionRate === null
            ? null
            : new Prisma.Decimal(opts.commissionRate ?? '10'),
      },
    }),
  );
  const recommendations = {
    findByOpportunityId,
  } as unknown as RecommendationRepository;

  const findCustomerById = vi.fn().mockResolvedValue({
    id: 'cust-1',
    ownerUserId: opts.ownerUserId ?? 'placement-1',
  });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn<(p: Record<string, unknown>) => Promise<unknown>>()
    .mockImplementation((p) => {
      if (p.entityType === 'Endorsement') {
        endo.status = p.toStatus as string;
        if (p.data) Object.assign(endo, p.data);
      } else if (p.entityType === 'Policy') {
        policyState.status = p.toStatus as string;
      }
      return Promise.resolve({ id: p.entityId, status: p.toStatus });
    });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  const reconcileReversalForPolicy = vi.fn().mockResolvedValue(undefined);
  const commissionLedger = {
    reconcileReversalForPolicy,
  } as unknown as import('../commission/commission-ledger.service').CommissionLedgerService;

  return {
    service: new EndorsementService(
      endorsements,
      policies,
      recommendations,
      customers,
      audit,
      workflow,
      commissionLedger,
    ),
    endo,
    policyState,
    mocks: {
      create,
      createCancellationEndorsement,
      createRefundAndReversal,
      findLiveCancellation,
      findById,
      findRefundById,
      updatePremiumAdjustment,
      recordRefundApproval,
      stampCancellationClientNotified,
      scheduleForEndorsement,
      versionScheduleForEndorsement,
      findByOpportunityId,
      findCustomerById,
      record,
      transition,
      reconcileReversalForPolicy,
    },
  };
}

/** Drive an endorsement from REQUESTED to INSURER_CONFIRMED. */
async function toInsurerConfirmed(service: EndorsementService) {
  await service.advance('end-1', {}, placement());
  await service.advance('end-1', {}, placement());
}

describe('EndorsementService', () => {
  describe('requestEndorsement', () => {
    it('creates a POSITIVE endorsement with a positive premium adjustment and audits CREATE', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.requestEndorsement(
        'pol-1',
        {
          type: 'POSITIVE',
          changeType: 'sum_insured_increase',
          premiumAmount: '300.5',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'pol-1',
          type: 'POSITIVE',
          changeType: 'sum_insured_increase',
          requestedByUserId: 'placement-1',
        }),
      );
      const arg = mocks.create.mock.calls[0][0] as {
        premiumAdjustment: Prisma.Decimal;
        effectiveFrom: Date;
      };
      expect(arg.premiumAdjustment.toFixed(3)).toBe('300.500');
      expect(arg.effectiveFrom.toISOString()).toBe('2026-06-30T00:00:00.000Z');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'Endorsement',
        }),
      );
      expect(view.status).toBe('REQUESTED');
      expect(view.premiumAdjustment).toBe('300.500');
    });

    it('stores a NEGATIVE adjustment as a negative number', async () => {
      const { service, mocks } = makeDeps();
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '120',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      const arg = mocks.create.mock.calls[0][0] as {
        premiumAdjustment: Prisma.Decimal;
      };
      expect(arg.premiumAdjustment.toFixed(3)).toBe('-120.000');
    });

    it('422 when the policy is not ACTIVE', async () => {
      const { service } = makeDeps({ policyStatus: 'DELIVERED' });
      await expect(
        service.requestEndorsement(
          'pol-1',
          {
            type: 'POSITIVE',
            changeType: 'address_change',
            premiumAmount: '0',
            effectiveFrom: '2026-06-30',
          } as never,
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('404 when the caller cannot see the customer', async () => {
      const { service } = makeDeps({ ownerUserId: 'someone-else' });
      await expect(
        service.requestEndorsement(
          'pol-1',
          {
            type: 'POSITIVE',
            changeType: 'address_change',
            premiumAmount: '0',
            effectiveFrom: '2026-06-30',
          } as never,
          placement({ id: 'sales-9', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('422 when effectiveFrom is before the current coverage-schedule version began', async () => {
      const { service } = makeDeps();
      await expect(
        service.requestEndorsement(
          'pol-1',
          {
            type: 'POSITIVE',
            changeType: 'sum_insured_increase',
            premiumAmount: '100',
            effectiveFrom: new Date(
              INCEPTION.getTime() - 5 * DAY,
            ).toISOString(),
          } as never,
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('requestCancellation', () => {
    it('computes the pro-rata return premium, stores it negative, and audits both rows', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.requestCancellation(
        'pol-1',
        {
          reason: 'client sold the insured property',
          basis: 'pro_rata',
          effectiveFrom: new Date(
            INCEPTION.getTime() + 180 * DAY,
          ).toISOString(),
        } as never,
        placement(),
      );
      // 1200.000 × 180/360 = 600.000 return; adjustment is negative
      expect(view.cancellation?.returnPremium).toBe('600.000');
      expect(view.premiumAdjustment).toBe('-600.000');
      expect(view.type).toBe('NEGATIVE');
      expect(view.changeType).toBe('cancellation');
      const cancelArgs = mocks.createCancellationEndorsement.mock.calls[0];
      expect(
        (
          cancelArgs[0] as { premiumAdjustment: Prisma.Decimal }
        ).premiumAdjustment.toFixed(3),
      ).toBe('-600.000');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'Cancellation',
        }),
      );
    });

    it('422 when the policy has no issued premium / period on record', async () => {
      const { service } = makeDeps({ issuedPremium: null });
      await expect(
        service.requestCancellation(
          'pol-1',
          {
            reason: 'no premium on file',
            basis: 'pro_rata',
            effectiveFrom: '2026-06-30',
          } as never,
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('409 when an in-flight cancellation already exists for the policy (pre-check)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findLiveCancellation.mockResolvedValue({
        id: 'end-existing',
        changeType: 'cancellation',
        status: 'INSURER_CONFIRMED',
      });
      await expect(
        service.requestCancellation(
          'pol-1',
          {
            reason: 'wrong basis picked the first time',
            basis: 'pro_rata',
            effectiveFrom: new Date(
              INCEPTION.getTime() + 180 * DAY,
            ).toISOString(),
          } as never,
          placement(),
        ),
      ).rejects.toThrow(ConflictException);
      expect(mocks.createCancellationEndorsement).not.toHaveBeenCalled();
    });

    it('409 when the partial-unique index rejects a concurrent second cancellation', async () => {
      const { service, mocks } = makeDeps();
      mocks.createCancellationEndorsement.mockRejectedValueOnce(p2002());
      await expect(
        service.requestCancellation(
          'pol-1',
          {
            reason: 'concurrent duplicate',
            basis: 'pro_rata',
            effectiveFrom: new Date(
              INCEPTION.getTime() + 180 * DAY,
            ).toISOString(),
          } as never,
          placement(),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('422 when the cancellation effectiveFrom is after the policy expires', async () => {
      const { service } = makeDeps();
      await expect(
        service.requestCancellation(
          'pol-1',
          {
            reason: 'backdated past the cover period',
            basis: 'pro_rata',
            effectiveFrom: new Date(EXPIRY.getTime() + 30 * DAY).toISOString(),
          } as never,
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('advance', () => {
    it('walks REQUESTED -> SUBMITTED_TO_INSURER -> INSURER_CONFIRMED', async () => {
      const { service, mocks } = makeDeps();
      const v1 = await service.advance('end-1', {}, placement());
      expect(v1.status).toBe('SUBMITTED_TO_INSURER');
      const v2 = await service.advance('end-1', {}, placement());
      expect(v2.status).toBe('INSURER_CONFIRMED');
      expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
        'SUBMITTED_TO_INSURER',
        'INSURER_CONFIRMED',
      ]);
    });

    it('422 once past INSURER_CONFIRMED', async () => {
      const { service } = makeDeps();
      await toInsurerConfirmed(service);
      await expect(service.advance('end-1', {}, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('calculateAdjustment', () => {
    it('POSITIVE: transitions to FINANCIAL_ADJUSTMENT_CALCULATED with no refund', async () => {
      const { service, mocks } = makeDeps();
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'POSITIVE',
          changeType: 'sum_insured_increase',
          premiumAmount: '400',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      const view = await service.calculateAdjustment('end-1', {}, placement());
      expect(view.status).toBe('FINANCIAL_ADJUSTMENT_CALCULATED');
      expect(view.refund).toBeNull();
      expect(mocks.createRefundAndReversal).not.toHaveBeenCalled();
    });

    it('NEGATIVE below threshold: auto-creates a below_threshold_auto refund + a reversal tied 1:1, stays FINANCIAL_ADJUSTMENT_CALCULATED', async () => {
      const { service, mocks } = makeDeps({ commissionRate: '12.5' });
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_employee',
          premiumAmount: '1000',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      const view = await service.calculateAdjustment('end-1', {}, placement());

      const refundCall = mocks.createRefundAndReversal.mock.calls[0];
      const refundArg = refundCall[0] as {
        amount: Prisma.Decimal;
        approvalThresholdMatrixLevel: string;
      };
      const reversalArg = refundCall[1] as { amount: Prisma.Decimal };
      expect(refundArg.amount.toFixed(3)).toBe('1000.000');
      expect(refundArg.approvalThresholdMatrixLevel).toBe(
        'below_threshold_auto',
      );
      // reversal = 1000.000 × 12.5% = 125.000 — computed from the SAME amount
      expect(reversalArg.amount.toFixed(3)).toBe('125.000');
      expect(view.status).toBe('FINANCIAL_ADJUSTMENT_CALCULATED');
      expect(view.refund?.needsApproval).toBe(false);
      expect(view.commissionReversal?.amount).toBe('125.000');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Refund' }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'CommissionReversal',
        }),
      );
      // Process 36 — the reversal is reflected onto the policy's commission
      // ledger entry (best-effort, non-fatal).
      expect(mocks.reconcileReversalForPolicy).toHaveBeenCalledWith(
        'pol-1',
        expect.any(String),
      );
    });

    it('a failure reflecting the commission reversal onto the ledger entry does not fail the endorsement (Process 36, best-effort)', async () => {
      const { service, mocks } = makeDeps({ commissionRate: '12.5' });
      mocks.reconcileReversalForPolicy.mockRejectedValueOnce(
        new Error('commission module down'),
      );
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_employee',
          premiumAmount: '1000',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      const view = await service.calculateAdjustment('end-1', {}, placement());
      expect(view.status).toBe('FINANCIAL_ADJUSTMENT_CALCULATED');
      expect(view.commissionReversal?.amount).toBe('125.000');
    });

    it('NEGATIVE at/above threshold: creates a requires_manager_approval refund and moves to REFUND_APPROVAL_PENDING', async () => {
      const { service, mocks } = makeDeps({ commissionRate: '10' });
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '5000',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      const view = await service.calculateAdjustment('end-1', {}, placement());
      expect(view.status).toBe('REFUND_APPROVAL_PENDING');
      expect(view.refund?.needsApproval).toBe(true);
      expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toContain(
        'REFUND_APPROVAL_PENDING',
      );
    });

    it('422 when the placed quotation captured no commission rate', async () => {
      const { service } = makeDeps({ commissionRate: null });
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '100',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await expect(
        service.calculateAdjustment('end-1', {}, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('maps a concurrent financial-artefact insert (P2002) to 409', async () => {
      const { service, mocks } = makeDeps();
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '100',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      mocks.createRefundAndReversal.mockRejectedValueOnce(p2002());
      await expect(
        service.calculateAdjustment('end-1', {}, placement()),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('apply', () => {
    it('FINANCIAL_ADJUSTMENT_CALCULATED -> APPLIED and versions the schedule', async () => {
      const { service, mocks } = makeDeps();
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'POSITIVE',
          changeType: 'coverage_amendment',
          premiumAmount: '50',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement());
      const view = await service.apply('end-1', placement());
      expect(view.status).toBe('APPLIED');
      expect(view.scheduleVersioned).toBe(true);
      expect(mocks.versionScheduleForEndorsement).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'pol-1',
          endorsementId: 'end-1',
          isCancellation: false,
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'PolicySchedule',
        }),
      );
    });

    it('422 while the endorsement is REFUND_APPROVAL_PENDING (must go via approve)', async () => {
      const { service } = makeDeps({ commissionRate: '10' });
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '6000',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement());
      await expect(service.apply('end-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('refuses apply when an at/above-threshold refund is unapproved even if the endorsement was stranded at FINANCIAL_ADJUSTMENT_CALCULATED (maker/checker gate is structural, not status-only)', async () => {
      const { service, endo } = makeDeps({ commissionRate: '10' });
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '9000',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement());
      // simulate a crash / concurrent call that stranded the endorsement one
      // hop short of REFUND_APPROVAL_PENDING with the above-threshold refund
      // still unapproved
      endo.status = 'FINANCIAL_ADJUSTMENT_CALCULATED';
      await expect(service.apply('end-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(endo.status).toBe('FINANCIAL_ADJUSTMENT_CALCULATED');
    });

    it('a cancellation apply transitions the Policy to CANCELLED', async () => {
      const { service, mocks, policyState } = makeDeps();
      await service.requestCancellation(
        'pol-1',
        {
          reason: 'client no longer requires cover',
          basis: 'pro_rata',
          effectiveFrom: new Date(
            INCEPTION.getTime() + 180 * DAY,
          ).toISOString(),
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement()); // 600 return < threshold
      const view = await service.apply('end-1', placement());
      expect(view.status).toBe('APPLIED');
      expect(policyState.status).toBe('CANCELLED');
      expect(
        mocks.transition.mock.calls.some(
          (c) => c[0].entityType === 'Policy' && c[0].toStatus === 'CANCELLED',
        ),
      ).toBe(true);
      // cover ends — no successor schedule row
      expect(view.scheduleVersioned).toBe(false);
    });

    it('a cancellation apply that CANNOT reach Policy CANCELLED is a hard 409, not a swallowed warn', async () => {
      const { service, endo, policyState, mocks } = makeDeps();
      await service.requestCancellation(
        'pol-1',
        {
          reason: 'client no longer requires cover',
          basis: 'pro_rata',
          effectiveFrom: new Date(
            INCEPTION.getTime() + 180 * DAY,
          ).toISOString(),
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement());
      // the Policy transition to CANCELLED fails and the policy is NOT already
      // CANCELLED (a concurrent divergent state) — Endorsement transitions
      // still succeed so it reaches APPLIED, then the Policy step throws.
      mocks.transition.mockImplementation((p: Record<string, unknown>) => {
        if (p.entityType === 'Policy') {
          return Promise.reject(new Error('illegal transition'));
        }
        endo.status = p.toStatus as string;
        return Promise.resolve({ id: p.entityId, status: p.toStatus });
      });
      policyState.status = 'EXPIRED';
      await expect(service.apply('end-1', placement())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('approveRefund', () => {
    async function toApprovalPending(service: EndorsementService) {
      await service.requestEndorsement(
        'pol-1',
        {
          type: 'NEGATIVE',
          changeType: 'remove_vehicle',
          premiumAmount: '8000',
          effectiveFrom: '2026-06-30',
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement());
    }

    it('403 when the approver is the officer who raised the refund (maker/checker)', async () => {
      const { service } = makeDeps({ commissionRate: '10' });
      await toApprovalPending(service);
      await expect(service.approveRefund('ref-1', placement())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('a distinct approver clears it, audits APPROVE, then applies + versions the schedule', async () => {
      const { service, mocks } = makeDeps({ commissionRate: '10' });
      await toApprovalPending(service);
      const view = await service.approveRefund(
        'ref-1',
        placement({ id: 'manager-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
      );
      expect(mocks.recordRefundApproval).toHaveBeenCalledWith(
        'ref-1',
        'manager-1',
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVE', entityType: 'Refund' }),
      );
      expect(view.status).toBe('APPLIED');
      expect(view.refund?.approvedByUserId).toBe('manager-1');
      expect(view.scheduleVersioned).toBe(true);
    });

    it('409 when the status-conditional approval write loses a concurrent race', async () => {
      const { service, mocks } = makeDeps({ commissionRate: '10' });
      await toApprovalPending(service);
      // The endorsement is still REFUND_APPROVAL_PENDING but a concurrent
      // approver already stamped the row — recordRefundApproval matches 0 rows.
      mocks.recordRefundApproval.mockResolvedValueOnce(null);
      await expect(
        service.approveRefund(
          'ref-1',
          placement({ id: 'manager-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('409 when the refund row already shows an approver', async () => {
      const { service, mocks } = makeDeps({ commissionRate: '10' });
      await toApprovalPending(service);
      mocks.findRefundById.mockResolvedValueOnce({
        id: 'ref-1',
        endorsementId: 'end-1',
        amount: new Prisma.Decimal('8000'),
        reason: 'premium_reduction',
        raisedByUserId: 'placement-1',
        approvedByUserId: 'manager-9',
        approvalThresholdMatrixLevel: 'approved',
        paidAt: null,
        endorsement: {
          id: 'end-1',
          status: 'REFUND_APPROVAL_PENDING',
          changeType: 'remove_vehicle',
          policy: {
            id: 'pol-1',
            customerId: 'cust-1',
            status: 'ACTIVE',
            opportunityId: 'opp-1',
          },
        },
      });
      await expect(
        service.approveRefund(
          'ref-1',
          placement({ id: 'manager-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('422 when the endorsement is not pending a refund approval', async () => {
      const { service, mocks } = makeDeps();
      // No refund raised — findRefundById returns null -> 404, not 422.
      mocks.findRefundById.mockResolvedValue({
        id: 'ref-x',
        endorsementId: 'end-1',
        amount: new Prisma.Decimal('100'),
        reason: 'premium_reduction',
        raisedByUserId: 'placement-1',
        approvedByUserId: null,
        approvalThresholdMatrixLevel: 'below_threshold_auto',
        paidAt: null,
        endorsement: {
          id: 'end-1',
          status: 'REQUESTED',
          changeType: 'remove_vehicle',
          policy: { id: 'pol-1', customerId: 'cust-1', status: 'ACTIVE' },
        },
      });
      await expect(
        service.approveRefund(
          'ref-x',
          placement({ id: 'manager-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('notifyClient', () => {
    it('APPLIED -> CLIENT_NOTIFIED and stamps the cancellation notice', async () => {
      const { service, mocks } = makeDeps();
      await service.requestCancellation(
        'pol-1',
        {
          reason: 'client no longer requires cover',
          basis: 'short_period',
          effectiveFrom: new Date(
            INCEPTION.getTime() + 180 * DAY,
          ).toISOString(),
        } as never,
        placement(),
      );
      await toInsurerConfirmed(service);
      await service.calculateAdjustment('end-1', {}, placement());
      await service.apply('end-1', placement());
      const view = await service.notifyClient('end-1', placement());
      expect(view.status).toBe('CLIENT_NOTIFIED');
      expect(mocks.stampCancellationClientNotified).toHaveBeenCalledWith(
        'canc-1',
      );
    });

    it('422 when the endorsement has not been APPLIED', async () => {
      const { service } = makeDeps();
      await toInsurerConfirmed(service);
      await expect(service.notifyClient('end-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('list / get', () => {
    it('list returns the per-policy endorsements after a visibility check', async () => {
      const { service, mocks } = makeDeps();
      const rows = await service.list('pol-1', placement());
      expect(rows).toHaveLength(1);
      expect(mocks.findCustomerById).toHaveBeenCalledWith('cust-1');
    });

    it('get 404s an endorsement the caller cannot see', async () => {
      const { service } = makeDeps({ ownerUserId: 'someone-else' });
      await expect(
        service.get(
          'end-1',
          placement({ id: 'sales-9', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
