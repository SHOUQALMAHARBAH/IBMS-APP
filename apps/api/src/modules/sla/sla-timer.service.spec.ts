import { describe, expect, it, vi } from 'vitest';
import { SlaTimerService } from './sla-timer.service';
import { applyDuration } from '../../common/business-days.util';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UserRepository } from '../../repositories/user.repository';

function makeDeps(overrides?: {
  createImpl?: (data: unknown) => { id: string } & Record<string, unknown>;
  findManyResult?: unknown[];
  updateManyCount?: number;
  systemUser?: { id: string } | null;
}) {
  let createCounter = 0;
  const create = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      createCounter += 1;
      return Promise.resolve(
        overrides?.createImpl?.(data) ?? {
          id: `timer-${createCounter}`,
          ...data,
        },
      );
    });
  const findMany = vi.fn().mockResolvedValue(overrides?.findManyResult ?? []);
  const updateMany = vi
    .fn()
    .mockResolvedValue({ count: overrides?.updateManyCount ?? 1 });

  const prisma = {
    client: {
      slaTimer: { create, findMany, updateMany },
    },
  } as unknown as PrismaService;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const findByEmail = vi
    .fn()
    .mockResolvedValue(
      overrides?.systemUser === undefined
        ? { id: 'system-user-1' }
        : overrides.systemUser,
    );
  const users = { findByEmail } as unknown as UserRepository;

  return {
    service: new SlaTimerService(prisma, audit, users),
    create,
    findMany,
    updateMany,
    record,
    findByEmail,
  };
}

describe('SlaTimerService.computeDueAt', () => {
  it('applies the registry duration to the base date', () => {
    const { service } = makeDeps();
    const base = new Date('2026-08-26T00:00:00.000Z');
    expect(service.computeDueAt('consent_withdrawal', base)).toEqual(
      applyDuration(base, { value: 2, unit: 'businessDays' }),
    );
  });

  it('uses the regulatory-channel override duration for data_sharing_decision when requested', () => {
    const { service } = makeDeps();
    const base = new Date('2026-08-26T00:00:00.000Z');
    expect(
      service.computeDueAt('data_sharing_decision', base, {
        regulatoryChannel: true,
      }),
    ).toEqual(applyDuration(base, { value: 1, unit: 'businessDays' }));
    expect(service.computeDueAt('data_sharing_decision', base)).toEqual(
      applyDuration(base, { value: 3, unit: 'businessDays' }),
    );
  });

  it('throws for an unknown workflow', () => {
    const { service } = makeDeps();
    expect(() => service.computeDueAt('not_a_workflow', new Date())).toThrow(
      /Unknown SLA workflow/,
    );
  });
});

describe('SlaTimerService.startTimer', () => {
  it('creates one row for a single-stage workflow and audits it', async () => {
    const { service, create, record } = makeDeps();
    const dueAt = new Date('2026-09-01T00:00:00.000Z');

    const created = await service.startTimer({
      entityType: 'ConsentRecord',
      entityId: 'consent-1',
      workflowName: 'consent_withdrawal',
      dueAt,
      actorUserId: 'user-1',
    });

    expect(created).toHaveLength(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        entityType: 'ConsentRecord',
        entityId: 'consent-1',
        workflowName: 'consent_withdrawal',
        dueAt,
        escalatedTo: null,
      },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'CREATE',
        entityType: 'ConsentRecord',
        entityId: 'consent-1',
      }),
    );
  });

  it('creates one row per escalation stage for a multi-stage workflow, in order', async () => {
    const { service, create } = makeDeps();
    const dueAt = new Date('2026-09-15T00:00:00.000Z');

    const created = await service.startTimer({
      entityType: 'DataSubjectRequest',
      entityId: 'dsr-1',
      workflowName: 'dsr_access_deletion',
      dueAt,
      actorUserId: 'dpo-1',
    });

    expect(created).toHaveLength(2);
    expect(create).toHaveBeenNthCalledWith(1, {
      data: {
        entityType: 'DataSubjectRequest',
        entityId: 'dsr-1',
        workflowName: 'dsr_access_deletion::data_protection_officer',
        dueAt: applyDuration(dueAt, { value: -3, unit: 'businessDays' }),
        escalatedTo: 'DATA_PROTECTION_OFFICER',
      },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        entityType: 'DataSubjectRequest',
        entityId: 'dsr-1',
        workflowName: 'dsr_access_deletion::general_manager',
        dueAt: applyDuration(dueAt, { value: 0, unit: 'businessDays' }),
        escalatedTo: 'GENERAL_MANAGER',
      },
    });
  });

  it('throws for an unknown workflow and creates nothing', async () => {
    const { service, create } = makeDeps();
    await expect(
      service.startTimer({
        entityType: 'X',
        entityId: 'x-1',
        workflowName: 'not_a_workflow',
        dueAt: new Date(),
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(/Unknown SLA workflow/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SlaTimerService.resolve', () => {
  it('resolves every open row for the entity+workflow and audits the count', async () => {
    const { service, updateMany, record } = makeDeps({ updateManyCount: 2 });
    const resolvedAt = new Date('2026-09-20T00:00:00.000Z');

    const result = await service.resolve({
      entityType: 'DataSubjectRequest',
      entityId: 'dsr-1',
      workflowName: 'dsr_access_deletion',
      actorUserId: 'dpo-1',
      resolvedAt,
    });

    expect(result).toEqual({ count: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        entityType: 'DataSubjectRequest',
        entityId: 'dsr-1',
        workflowName: { startsWith: 'dsr_access_deletion' },
        resolvedAt: null,
      },
      data: { resolvedAt },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'dpo-1',
        action: 'UPDATE',
        entityType: 'DataSubjectRequest',
        entityId: 'dsr-1',
      }),
    );
  });

  it('does not audit when nothing was open to resolve', async () => {
    const { service, record } = makeDeps({ updateManyCount: 0 });

    const result = await service.resolve({
      entityType: 'ConsentRecord',
      entityId: 'consent-1',
      workflowName: 'consent_withdrawal',
      actorUserId: 'user-1',
    });

    expect(result).toEqual({ count: 0 });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('SlaTimerService.runEscalationSweep', () => {
  const overdueTimer = {
    id: 'timer-1',
    entityType: 'DisposalBatch',
    entityId: 'batch-1',
    workflowName: 'disposal_batch_execution',
    dueAt: new Date('2026-08-01T00:00:00.000Z'),
    escalatedTo: null,
    escalatedAt: null,
    resolvedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  };

  it('returns [] and never looks up the system user when nothing is due', async () => {
    const { service, findByEmail, updateMany } = makeDeps({
      findManyResult: [],
    });

    const result = await service.runEscalationSweep();

    expect(result).toEqual([]);
    expect(findByEmail).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('escalates each overdue, unescalated row and audits SLA_ESCALATED', async () => {
    const now = new Date('2026-08-26T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const { service, updateMany, record } = makeDeps({
        findManyResult: [overdueTimer],
        updateManyCount: 1,
      });

      const result = await service.runEscalationSweep();

      expect(result).toEqual([{ ...overdueTimer, escalatedAt: now }]);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'timer-1', escalatedAt: null },
        data: { escalatedAt: now },
      });
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'system-user-1',
          action: 'SLA_ESCALATED',
          entityType: 'DisposalBatch',
          entityId: 'batch-1',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a row a concurrent sweep already escalated, without auditing it', async () => {
    const { service, record } = makeDeps({
      findManyResult: [overdueTimer],
      updateManyCount: 0,
    });

    const result = await service.runEscalationSweep();

    expect(result).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it('logs and escalates nothing when the system service account is missing', async () => {
    const { service, updateMany, record } = makeDeps({
      findManyResult: [overdueTimer],
      systemUser: null,
    });

    const result = await service.runEscalationSweep();

    expect(result).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
