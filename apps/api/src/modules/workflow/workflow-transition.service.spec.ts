import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowTransitionService } from './workflow-transition.service';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makeDeps(overrides?: {
  current?: { id: string; status: string } | null;
  updateManyCount?: number;
  updated?: { id: string; status: string } | null;
}) {
  const current =
    overrides?.current === undefined
      ? { id: 'opp-1', status: 'NEEDS_CONFIRMED' }
      : overrides.current;
  const updated =
    overrides?.updated === undefined
      ? { id: 'opp-1', status: 'RFQ_ISSUED' }
      : overrides.updated;

  const findUnique = vi
    .fn()
    .mockResolvedValueOnce(current)
    .mockResolvedValue(updated);
  const updateMany = vi
    .fn()
    .mockResolvedValue({ count: overrides?.updateManyCount ?? 1 });

  const prisma = {
    client: {
      opportunity: { findUnique, updateMany },
    },
  } as unknown as PrismaService;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new WorkflowTransitionService(prisma, audit),
    findUnique,
    updateMany,
    record,
  };
}

describe('WorkflowTransitionService.transition', () => {
  it('validates, persists, and audits a legal transition', async () => {
    const { service, updateMany, record } = makeDeps();

    const result = await service.transition({
      entityType: 'Opportunity',
      entityId: 'opp-1',
      toStatus: 'RFQ_ISSUED',
      actorUserId: 'user-1',
    });

    expect(result).toEqual({ id: 'opp-1', status: 'RFQ_ISSUED' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'opp-1', status: 'NEEDS_CONFIRMED' },
      data: { status: 'RFQ_ISSUED' },
    });
    expect(record).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'TRANSITION',
      entityType: 'Opportunity',
      entityId: 'opp-1',
      beforeValue: { status: 'NEEDS_CONFIRMED' },
      afterValue: { status: 'RFQ_ISSUED' },
    });
  });

  it('passes extra data through to the same write', async () => {
    const { service, updateMany } = makeDeps();

    await service.transition({
      entityType: 'Opportunity',
      entityId: 'opp-1',
      toStatus: 'RFQ_ISSUED',
      actorUserId: 'user-1',
      data: { rfqIssuedAt: '2026-08-26T00:00:00.000Z' },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'opp-1', status: 'NEEDS_CONFIRMED' },
      data: { status: 'RFQ_ISSUED', rfqIssuedAt: '2026-08-26T00:00:00.000Z' },
    });
  });

  it('runs sideEffect after the status write and audit row are committed', async () => {
    const { service, record } = makeDeps();
    const sideEffect = vi.fn().mockResolvedValue(undefined);

    await service.transition({
      entityType: 'Opportunity',
      entityId: 'opp-1',
      toStatus: 'RFQ_ISSUED',
      actorUserId: 'user-1',
      sideEffect,
    });

    expect(sideEffect).toHaveBeenCalledWith({
      id: 'opp-1',
      status: 'RFQ_ISSUED',
    });
    // Order matters: the audit row must exist before the side effect runs.
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(
      sideEffect.mock.invocationCallOrder[0],
    );
  });

  it('does not throw when sideEffect rejects — the transition already committed', async () => {
    const { service } = makeDeps();
    const sideEffect = vi.fn().mockRejectedValue(new Error('notify failed'));

    await expect(
      service.transition({
        entityType: 'Opportunity',
        entityId: 'opp-1',
        toStatus: 'RFQ_ISSUED',
        actorUserId: 'user-1',
        sideEffect,
      }),
    ).resolves.toEqual({ id: 'opp-1', status: 'RFQ_ISSUED' });
  });

  it('rejects an illegal transition and writes nothing', async () => {
    const { service, updateMany, record } = makeDeps();

    await expect(
      service.transition({
        entityType: 'Opportunity',
        entityId: 'opp-1',
        toStatus: 'PLACEMENT',
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a no-op transition to the same status', async () => {
    const { service } = makeDeps({
      current: { id: 'opp-1', status: 'RFQ_ISSUED' },
    });

    await expect(
      service.transition({
        entityType: 'Opportunity',
        entityId: 'opp-1',
        toStatus: 'RFQ_ISSUED',
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws NotFoundException when the entity does not exist', async () => {
    const { service } = makeDeps({ current: null });

    await expect(
      service.transition({
        entityType: 'Opportunity',
        entityId: 'missing',
        toStatus: 'RFQ_ISSUED',
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when the status changed concurrently', async () => {
    const { service, record } = makeDeps({ updateManyCount: 0 });

    await expect(
      service.transition({
        entityType: 'Opportunity',
        entityId: 'opp-1',
        toStatus: 'RFQ_ISSUED',
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(ConflictException);
    expect(record).not.toHaveBeenCalled();
  });
});
