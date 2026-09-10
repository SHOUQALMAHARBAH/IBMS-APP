import { describe, expect, it, vi } from 'vitest';
import type { SlaPolicyRepository } from '../../repositories/sla-policy.repository';
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
  policies?: Record<string, unknown>;
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

  const policies = {
    ...policiesRepoMock(),
    ...((overrides as { policies?: object } | undefined)?.policies ?? {}),
  } as unknown as SlaPolicyRepository;

  return {
    service: new SlaTimerService(prisma, audit, users, policies),
    create,
    findMany,
    updateMany,
    record,
    findByEmail,
    policies,
  };
}

/** No SLA policies configured — every existing test exercises the
 * registry-fallback path, which is exactly the behaviour that must keep
 * working on a database that has not been seeded with policies. */
function policiesRepoMock() {
  return {
    findActiveFor: vi.fn().mockResolvedValue(null),
    findHolidays: vi.fn().mockResolvedValue([]),
  } as unknown as SlaPolicyRepository;
}

describe('SlaTimerService.computeDueAt — reads the CONFIGURED policy', () => {
  it('falls back to the registry duration when no policy is configured', async () => {
    // The un-seeded path: behaviour must be exactly what it was before SLA
    // policies existed.
    const { service } = makeDeps();
    const base = new Date('2026-08-26T00:00:00.000Z');
    await expect(
      service.computeDueAt('consent_withdrawal', base),
    ).resolves.toEqual(applyDuration(base, { value: 2, unit: 'businessDays' }));
  });

  it('PREFERS the configured policy over the registry constant', async () => {
    // The whole point: changing a deadline is a row update, not a deploy.
    const { service } = makeDeps({
      policies: {
        findActiveFor: vi.fn().mockResolvedValue({
          id: 'p-1',
          durationValue: 9,
          durationUnit: 'BUSINESS_DAYS',
          calendarType: 'JORDAN_STANDARD',
          customWeekendDays: [],
          escalationEnabled: true,
          escalations: [],
        }),
        findHolidays: vi.fn().mockResolvedValue([]),
      },
    });
    const base = new Date('2026-08-26T00:00:00.000Z');
    await expect(
      service.computeDueAt('consent_withdrawal', base),
    ).resolves.toEqual(applyDuration(base, { value: 9, unit: 'businessDays' }));
  });

  it('applies the configured HOLIDAY calendar', async () => {
    const { service } = makeDeps({
      policies: {
        findActiveFor: vi.fn().mockResolvedValue({
          id: 'p-1',
          durationValue: 3,
          durationUnit: 'BUSINESS_DAYS',
          calendarType: 'JORDAN_STANDARD',
          customWeekendDays: [],
          escalationEnabled: true,
          escalations: [],
        }),
        findHolidays: vi
          .fn()
          .mockResolvedValue([
            { observedOn: new Date('2027-01-10T00:00:00.000Z') },
          ]),
      },
    });
    const due = await service.computeDueAt(
      'consent_withdrawal',
      new Date('2027-01-07T00:00:00.000Z'),
    );
    expect(due.toISOString().slice(0, 10)).toBe('2027-01-13');
  });

  it('keeps the regulatory-channel FAST TRACK on its registry value', async () => {
    // A policy models one duration, so serving the standard one here would
    // LENGTHEN a deadline that exists specifically to be shorter.
    const { service } = makeDeps({
      policies: {
        findActiveFor: vi.fn().mockResolvedValue({
          id: 'p-1',
          durationValue: 30,
          durationUnit: 'BUSINESS_DAYS',
          calendarType: 'JORDAN_STANDARD',
          customWeekendDays: [],
          escalationEnabled: true,
          escalations: [],
        }),
        findHolidays: vi.fn().mockResolvedValue([]),
      },
    });
    const base = new Date('2026-08-26T00:00:00.000Z');
    await expect(
      service.computeDueAt('data_sharing_decision', base, {
        regulatoryChannel: true,
      }),
    ).resolves.toEqual(applyDuration(base, { value: 1, unit: 'businessDays' }));
  });

  it('still throws for an unknown workflow with no policy', async () => {
    const { service } = makeDeps();
    await expect(
      service.computeDueAt('not_a_workflow', new Date()),
    ).rejects.toThrow(/Unknown SLA workflow/);
  });

  it('computeDueAtFromRegistry stays synchronous for the default path', () => {
    const { service } = makeDeps();
    const base = new Date('2026-08-26T00:00:00.000Z');
    expect(
      service.computeDueAtFromRegistry('consent_withdrawal', base),
    ).toEqual(applyDuration(base, { value: 2, unit: 'businessDays' }));
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
        // Null because no policy is configured in this fixture. When one is,
        // the timer records WHICH policy set its deadline, so a historical
        // timer can still say whether it was regulatory or internal.
        slaPolicyId: null,
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
        slaPolicyId: null,
      },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        entityType: 'DataSubjectRequest',
        entityId: 'dsr-1',
        workflowName: 'dsr_access_deletion::general_manager',
        dueAt: applyDuration(dueAt, { value: 0, unit: 'businessDays' }),
        escalatedTo: 'GENERAL_MANAGER',
        slaPolicyId: null,
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

  it('with createdBefore, only matches rows created before that instant — for a caller that starts the new timer(s) first and must not resolve them too', async () => {
    const { service, updateMany } = makeDeps({ updateManyCount: 2 });
    const cutoff = new Date('2026-09-20T00:00:00.000Z');

    await service.resolve({
      entityType: 'DataSubjectRequest',
      entityId: 'dsr-1',
      workflowName: 'dsr_access_deletion',
      actorUserId: 'dpo-1',
      createdBefore: cutoff,
    });

    const call = updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: { resolvedAt: unknown };
    };
    expect(call.where).toEqual({
      entityType: 'DataSubjectRequest',
      entityId: 'dsr-1',
      workflowName: { startsWith: 'dsr_access_deletion' },
      resolvedAt: null,
      createdAt: { lt: cutoff },
    });
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
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

describe('startTimer uses the CONFIGURED policy, not the registry constant', () => {
  const configuredPolicy = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    durationValue: 3,
    durationUnit: 'BUSINESS_DAYS',
    calendarType: 'JORDAN_STANDARD',
    customWeekendDays: [],
    escalationEnabled: true,
    escalations: [
      {
        stageOrder: 0,
        offsetValue: -2,
        offsetUnit: 'BUSINESS_DAYS',
        escalateTo: 'COMPLIANCE_OFFICER',
      },
      {
        stageOrder: 1,
        offsetValue: 0,
        offsetUnit: 'BUSINESS_DAYS',
        escalateTo: null,
      },
    ],
    ...over,
  });

  it('records WHICH policy set the deadline on every timer it creates', async () => {
    // Without this a historical timer cannot say whether the deadline it
    // missed was regulatory or internal — the policy may have been edited
    // since.
    const { service, create } = makeDeps({
      policies: {
        findActiveFor: vi.fn().mockResolvedValue(configuredPolicy()),
        findHolidays: vi.fn().mockResolvedValue([]),
      },
    });
    await service.startTimer({
      entityType: 'ConsentRecord',
      entityId: 'consent-1',
      workflowName: 'consent_withdrawal',
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
      actorUserId: 'user-1',
    });
    for (const call of create.mock.calls as [
      { data: { slaPolicyId: string } },
    ][]) {
      expect(call[0].data.slaPolicyId).toBe('p-1');
    }
  });

  it('uses the POLICY escalation stages, not the registry ones', async () => {
    // consent_withdrawal has ONE registry stage. The configured policy has
    // two, so the count proves which source was read.
    const { service, create } = makeDeps({
      policies: {
        findActiveFor: vi.fn().mockResolvedValue(configuredPolicy()),
        findHolidays: vi.fn().mockResolvedValue([]),
      },
    });
    const created = await service.startTimer({
      entityType: 'ConsentRecord',
      entityId: 'consent-1',
      workflowName: 'consent_withdrawal',
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
      actorUserId: 'user-1',
    });
    expect(created).toHaveLength(2);
    const escalatedTo = (
      create.mock.calls as [{ data: { escalatedTo: string | null } }][]
    ).map((c) => c[0].data.escalatedTo);
    expect(escalatedTo).toEqual(['COMPLIANCE_OFFICER', null]);
  });

  it('escalationEnabled=false keeps the DEADLINE but drops the notifications', async () => {
    // Turning escalation off must not turn the SLA off: a queryable,
    // sweep-checked deadline row is the whole point of the registry.
    const { service, create } = makeDeps({
      policies: {
        findActiveFor: vi
          .fn()
          .mockResolvedValue(configuredPolicy({ escalationEnabled: false })),
        findHolidays: vi.fn().mockResolvedValue([]),
      },
    });
    const dueAt = new Date('2026-09-01T00:00:00.000Z');
    const created = await service.startTimer({
      entityType: 'ConsentRecord',
      entityId: 'consent-1',
      workflowName: 'consent_withdrawal',
      dueAt,
      actorUserId: 'user-1',
    });
    expect(created).toHaveLength(1);
    const [call] = create.mock.calls as [
      { data: { dueAt: Date; escalatedTo: string | null } },
    ][];
    expect(call[0].data.dueAt).toEqual(dueAt);
    expect(call[0].data.escalatedTo).toBeNull();
  });

  it('falls back to registry stages when no policy is configured', async () => {
    const { service, create } = makeDeps();
    await service.startTimer({
      entityType: 'ConsentRecord',
      entityId: 'consent-1',
      workflowName: 'consent_withdrawal',
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
      actorUserId: 'user-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
