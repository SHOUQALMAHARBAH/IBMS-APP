import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { CrossSellService } from './cross-sell.service';
import type { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
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

function makeDeps() {
  const findById = vi.fn();
  const findManyByCustomerId = vi.fn().mockResolvedValue([]);
  const findExistingGapLines = vi.fn().mockResolvedValue([]);
  const createGap = vi
    .fn()
    .mockImplementation((input: { gapLine: string }) =>
      Promise.resolve({ id: `opp-${input.gapLine}`, status: 'OPEN', ...input }),
    );
  const findInForcePolicyLinesByCustomerId = vi.fn().mockResolvedValue([]);
  const findCustomerIdsWithInForcePolicy = vi.fn().mockResolvedValue([]);
  const opportunities = {
    findById,
    findManyByCustomerId,
    findExistingGapLines,
    createGap,
    findInForcePolicyLinesByCustomerId,
    findCustomerIdsWithInForcePolicy,
  } as unknown as CrossSellOpportunityRepository;

  const findCustomerById = vi.fn().mockResolvedValue(OWNED_CUSTOMER);
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi.fn().mockResolvedValue({ id: 'opp-1', status: 'x' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new CrossSellService(opportunities, customers, audit, workflow),
    mocks: {
      findById,
      findManyByCustomerId,
      findExistingGapLines,
      createGap,
      findInForcePolicyLinesByCustomerId,
      findCustomerIdsWithInForcePolicy,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('CrossSellService.runDetection', () => {
  it('does nothing for a customer with no in-force policies', async () => {
    const { service, mocks } = makeDeps();
    mocks.findInForcePolicyLinesByCustomerId.mockResolvedValue([]);

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(outcome.newlyFlagged).toEqual([]);
    expect(mocks.createGap).not.toHaveBeenCalled();
  });

  it('flags every benchmark line the customer holds no cover for', async () => {
    const { service, mocks } = makeDeps();
    mocks.findInForcePolicyLinesByCustomerId.mockResolvedValue([
      'Property All Risks',
      'Motor Fleet', // not a benchmark line — ignored
    ]);

    const outcome = await service.runDetection('cust-1', 'sys-1');

    // createGap's mock echoes input.gapLine onto the returned row, so
    // newlyFlagged's gapLines are exactly the gaps passed to createGap, in order.
    expect(mocks.createGap).toHaveBeenCalledTimes(3);
    expect(outcome.newlyFlagged.map((o) => o.gapLine)).toEqual([
      'Business Interruption',
      'Public Liability',
      'Workers Compensation',
    ]);
    // One CREATE audit row per opportunity actually inserted.
    expect(mocks.record).toHaveBeenCalledTimes(3);
  });

  it('skips a gap a concurrent scan already inserted (P2002), still flagging the rest', async () => {
    const { service, mocks } = makeDeps();
    mocks.findInForcePolicyLinesByCustomerId.mockResolvedValue([
      'Property All Risks',
    ]);
    // The 2nd insert loses a race — the unique index rejects it.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    mocks.createGap
      .mockImplementationOnce((input: { gapLine: string }) =>
        Promise.resolve({ id: 'opp-1', status: 'OPEN', ...input }),
      )
      .mockImplementationOnce(() => Promise.reject(p2002))
      .mockImplementationOnce((input: { gapLine: string }) =>
        Promise.resolve({ id: 'opp-3', status: 'OPEN', ...input }),
      );

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(mocks.createGap).toHaveBeenCalledTimes(3);
    expect(outcome.newlyFlagged.map((o) => o.gapLine)).toEqual([
      'Business Interruption',
      'Workers Compensation',
    ]);
    expect(mocks.record).toHaveBeenCalledTimes(2);
  });

  it('does not re-flag a gap that already has a row in any status', async () => {
    const { service, mocks } = makeDeps();
    mocks.findInForcePolicyLinesByCustomerId.mockResolvedValue([
      'Property All Risks',
      'Business Interruption',
      'Public Liability',
    ]);
    // Workers Compensation is the only gap, and it was already dismissed.
    mocks.findExistingGapLines.mockResolvedValue(['Workers Compensation']);

    const outcome = await service.runDetection('cust-1', 'sys-1');

    expect(mocks.createGap).not.toHaveBeenCalled();
    expect(outcome.newlyFlagged).toEqual([]);
    expect(outcome.gapLines).toEqual(['Workers Compensation']);
  });

  it('returns early for a customer that no longer exists', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue(null);

    const outcome = await service.runDetection('gone', 'sys-1');

    expect(outcome.newlyFlagged).toEqual([]);
    expect(mocks.findInForcePolicyLinesByCustomerId).not.toHaveBeenCalled();
  });
});

describe('CrossSellService.detect', () => {
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

  it('lets a Manager scan a customer they do not own', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      id: 'cust-9',
      ownerUserId: 'someone-else',
    });

    const view = await service.detect(
      'cust-9',
      sales({ id: 'mgr-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
    );

    expect(view.benchmarkLines.length).toBeGreaterThan(0);
  });
});

describe('CrossSellService.convert / dismiss', () => {
  it('convert() drives OPEN -> CONVERTED through the workflow engine, stamping the resolver', async () => {
    const { service, mocks } = makeDeps();
    mocks.findById.mockResolvedValue({
      id: 'opp-1',
      customerId: 'cust-1',
      status: 'OPEN',
    });

    await service.convert('opp-1', sales());

    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CrossSellOpportunity',
        entityId: 'opp-1',
        toStatus: 'CONVERTED',
        actorUserId: 'sales-1',
      }),
    );
    const [convertParams] = mocks.transition.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(convertParams.data.resolvedByUserId).toBe('sales-1');
    expect(convertParams.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('dismiss() drives OPEN -> DISMISSED and persists the reason', async () => {
    const { service, mocks } = makeDeps();
    mocks.findById.mockResolvedValue({
      id: 'opp-1',
      customerId: 'cust-1',
      status: 'OPEN',
    });

    await service.dismiss('opp-1', sales(), 'Client declined');

    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        toStatus: 'DISMISSED',
        actorUserId: 'sales-1',
      }),
    );
    const [dismissParams] = mocks.transition.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(dismissParams.data).toMatchObject({
      resolvedByUserId: 'sales-1',
      dismissReason: 'Client declined',
    });
  });

  it("404s convert() on another Sales Officer's opportunity", async () => {
    const { service, mocks } = makeDeps();
    mocks.findById.mockResolvedValue({
      id: 'opp-1',
      customerId: 'cust-1',
      status: 'OPEN',
    });
    mocks.findCustomerById.mockResolvedValue({
      id: 'cust-1',
      ownerUserId: 'someone-else',
    });

    await expect(service.convert('opp-1', sales())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
