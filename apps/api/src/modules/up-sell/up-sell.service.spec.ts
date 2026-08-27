import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { UpSellService } from './up-sell.service';
import type { UpSellRecommendationRepository } from '../../repositories/up-sell-recommendation.repository';
import type { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import type { RiskProfileRepository } from '../../repositories/risk-profile.repository';
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

const OWNED_CUSTOMER = { id: 'cust-1', ownerUserId: 'sales-1' };

/** A non-SUPERSEDED programme with one Property All Risks line at `basis`. */
function programWithPropertyBasis(basis: string | null) {
  return [
    {
      status: 'FINALIZED',
      lines: [
        {
          insuranceLine: 'Property All Risks',
          sumInsuredBasis: basis == null ? null : new Prisma.Decimal(basis),
        },
      ],
    },
  ];
}

/** One building asset worth `declaredValue` — deriveSumInsured turns this
 * into propertySumInsured = declaredValue. */
function buildingAssets(declaredValue: string) {
  return [
    {
      assetType: 'building',
      declaredValue: new Prisma.Decimal(declaredValue),
      annualGrossProfit: null,
      indemnityPeriodMonths: null,
      fleetVehicleCount: null,
    },
  ];
}

function makeDeps() {
  const findById = vi.fn();
  const findManyByCustomerId = vi.fn().mockResolvedValue([]);
  const findLatestResolvedByCustomerId = vi.fn().mockResolvedValue(null);
  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ id: 'rec-1', status: 'OPEN', ...input }),
    );
  const recommendations = {
    findById,
    findManyByCustomerId,
    findLatestResolvedByCustomerId,
    create,
  } as unknown as UpSellRecommendationRepository;

  const findProgramsByCustomerId = vi.fn().mockResolvedValue([]);
  const findCustomerIdsWithLiveProgram = vi.fn().mockResolvedValue([]);
  const insurancePrograms = {
    findManyByCustomerId: findProgramsByCustomerId,
    findCustomerIdsWithLiveProgram,
  } as unknown as InsuranceProgramRepository;

  const findAssetsByCustomerId = vi.fn().mockResolvedValue([]);
  const riskProfiles = {
    findAssetsByCustomerId,
  } as unknown as RiskProfileRepository;

  const findCustomerById = vi.fn().mockResolvedValue(OWNED_CUSTOMER);
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi.fn().mockResolvedValue({ id: 'rec-1', status: 'x' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new UpSellService(
      recommendations,
      insurancePrograms,
      riskProfiles,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      findById,
      findManyByCustomerId,
      findLatestResolvedByCustomerId,
      create,
      findProgramsByCustomerId,
      findCustomerIdsWithLiveProgram,
      findAssetsByCustomerId,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('UpSellService.runDetection', () => {
  it('flags a customer whose asset value exceeds the designed Sum Insured by > the threshold', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis('100000'),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('130000'));

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.isUnderinsured).toBe(true);
    expect(outcome.currentSumInsured).toBe('100000.000');
    expect(outcome.currentAssetValue).toBe('130000.000');
    expect(outcome.shortfall).toBe('30000.000');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        detectedByUserId: 'sys-1',
      }),
    );
    expect(outcome.flagged?.id).toBe('rec-1');
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it('does not flag a customer who is adequately insured', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis('100000'),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('105000'));

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.isUnderinsured).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not flag when there is no property Sum Insured to compare against', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis(null),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('500000'));

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.currentSumInsured).toBe('0.000');
    expect(outcome.isUnderinsured).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('suppresses a re-flag when the customer already resolved one at this asset value or higher', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis('100000'),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('130000'));
    mocks.findLatestResolvedByCustomerId.mockResolvedValue({
      id: 'rec-old',
      status: 'DISMISSED',
      currentAssetValue: new Prisma.Decimal('130000'),
    });

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.isUnderinsured).toBe(true);
    expect(outcome.suppressedByPriorResolution).toBe(true);
    expect(outcome.flagged).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('suppresses equally off a CONVERTED prior (the endorsement is unbuilt, but detection still defers)', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis('100000'),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('130000'));
    mocks.findLatestResolvedByCustomerId.mockResolvedValue({
      id: 'rec-old',
      status: 'CONVERTED',
      currentAssetValue: new Prisma.Decimal('130000'),
    });

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.suppressedByPriorResolution).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('re-flags once the asset value has grown past what was last resolved', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis('100000'),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('160000'));
    mocks.findLatestResolvedByCustomerId.mockResolvedValue({
      id: 'rec-old',
      status: 'DISMISSED',
      currentAssetValue: new Prisma.Decimal('130000'),
    });

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.suppressedByPriorResolution).toBe(false);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('skips gracefully when a concurrent scan flagged the customer first (P2002)', async () => {
    const { service, mocks } = makeDeps();
    mocks.findProgramsByCustomerId.mockResolvedValue(
      programWithPropertyBasis('100000'),
    );
    mocks.findAssetsByCustomerId.mockResolvedValue(buildingAssets('130000'));
    mocks.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.flagged).toBeNull();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('returns a zeroed outcome for a customer that no longer exists', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue(null);

    const outcome = await service.runDetection('gone', 'sys-1');

    expect(outcome.isUnderinsured).toBe(false);
    expect(outcome.flagged).toBeNull();
    expect(mocks.findProgramsByCustomerId).not.toHaveBeenCalled();
  });
});

describe('UpSellService.detect', () => {
  it("404s a customer the caller can't see (no existence oracle)", async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      id: 'cust-9',
      ownerUserId: 'someone-else',
    });

    await expect(service.detect('cust-9', sales())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets a Manager scan a customer they do not own and echoes the threshold', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      id: 'cust-9',
      ownerUserId: 'someone-else',
    });

    const view = await service.detect(
      'cust-9',
      sales({ id: 'mgr-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
    );

    expect(view.thresholdPercent).toBe('10');
    expect(view.openRecommendation).toBeNull();
  });
});

describe('UpSellService.convert / dismiss', () => {
  it('convert() drives OPEN -> CONVERTED through the workflow engine, stamping the resolver', async () => {
    const { service, mocks } = makeDeps();
    mocks.findById.mockResolvedValue({
      id: 'rec-1',
      customerId: 'cust-1',
      status: 'OPEN',
    });

    await service.convert('rec-1', sales());

    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'UpSellRecommendation',
        entityId: 'rec-1',
        toStatus: 'CONVERTED',
        actorUserId: 'sales-1',
      }),
    );
    const [params] = mocks.transition.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(params.data.resolvedByUserId).toBe('sales-1');
    expect(params.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('dismiss() drives OPEN -> DISMISSED and persists the reason', async () => {
    const { service, mocks } = makeDeps();
    mocks.findById.mockResolvedValue({
      id: 'rec-1',
      customerId: 'cust-1',
      status: 'OPEN',
    });

    await service.dismiss('rec-1', sales(), 'Client declined the increase');

    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        toStatus: 'DISMISSED',
        actorUserId: 'sales-1',
      }),
    );
    const [params] = mocks.transition.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(params.data).toMatchObject({
      resolvedByUserId: 'sales-1',
      dismissReason: 'Client declined the increase',
    });
  });

  it("404s convert() on another Sales Officer's recommendation", async () => {
    const { service, mocks } = makeDeps();
    mocks.findById.mockResolvedValue({
      id: 'rec-1',
      customerId: 'cust-1',
      status: 'OPEN',
    });
    mocks.findCustomerById.mockResolvedValue({
      id: 'cust-1',
      ownerUserId: 'someone-else',
    });

    await expect(service.convert('rec-1', sales())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
