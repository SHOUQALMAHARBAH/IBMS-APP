import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service';
import type { AuditAnomalyDetectionService } from './audit-anomaly-detection.service';
import { OrgContextService } from '../../common/org-context/org-context.service';
import type { PrismaService } from '../../prisma/prisma.service';
import fs from 'node:fs';
import path from 'node:path';

function makeDeps(overrides?: {
  createdEntry?: Record<string, unknown>;
  retentionScheduleItem?: { retentionPeriodMonths: number } | null;
}): {
  service: AuditService;
  orgContext: OrgContextService;
  create: ReturnType<typeof vi.fn>;
  createManyAndReturn: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
} {
  const createdEntry = overrides?.createdEntry ?? {
    id: 'entry-1',
    userId: 'user-1',
    action: 'CREATE',
    entityType: 'Customer',
    entityId: 'customer-1',
    isSensitiveDataAccess: false,
    occurredAt: new Date(),
  };
  const create = vi.fn().mockResolvedValue(createdEntry);
  const createManyAndReturn = vi
    .fn()
    .mockImplementation((args: { data: Record<string, unknown>[] }) =>
      Promise.resolve(
        args.data.map((row, i) => ({
          ...createdEntry,
          ...row,
          id: `entry-${i + 1}`,
        })),
      ),
    );
  const findFirst = vi
    .fn()
    .mockResolvedValue(
      overrides?.retentionScheduleItem === undefined
        ? null
        : overrides.retentionScheduleItem,
    );

  const prisma = {
    client: {
      auditLogEntry: { create, createManyAndReturn },
      retentionScheduleItem: { findFirst },
    },
  } as unknown as PrismaService;

  const evaluate = vi.fn().mockResolvedValue(undefined);
  const anomalyDetection = {
    evaluate,
  } as unknown as AuditAnomalyDetectionService;

  // A real OrgContextService, not a stub: the roles it returns are what the service writes, and
  // a stub returning `null` would make every assertion below agree with a service that never
  // reads the context at all. Tests that want an actor wrap their call in `runForRequest` +
  // `adoptActorRoles`; the rest legitimately have none, which is the scheduler/seed case.
  const orgContext = new OrgContextService();

  return {
    service: new AuditService(prisma, anomalyDetection, orgContext),
    orgContext,
    create,
    createManyAndReturn,
    findFirst,
    evaluate,
  };
}

/** The `data` payload of a mocked Prisma write, typed — `mock.calls[0][0]` is `any`, and the
 *  actor-role assertions below read two fields off it. */
interface WrittenAuditRow {
  actorRoleIds: string[];
  actorRoleNames: string[];
}
function writtenRow(mock: ReturnType<typeof vi.fn>): WrittenAuditRow {
  return (mock.mock.calls[0][0] as { data: WrittenAuditRow }).data;
}
function writtenRows(mock: ReturnType<typeof vi.fn>): WrittenAuditRow[] {
  return (mock.mock.calls[0][0] as { data: WrittenAuditRow[] }).data;
}

describe('AuditService', () => {
  describe('record', () => {
    it('writes the entry and hands it to anomaly detection', async () => {
      const { service, create, evaluate } = makeDeps();
      await service.record({
        userId: 'user-1',
        action: 'CREATE',
        entityType: 'Customer',
        entityId: 'customer-1',
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'entry-1' }),
      );
    });
  });

  describe('recordMany', () => {
    it('writes all entries in one createManyAndReturn and runs anomaly detection per row', async () => {
      const { service, create, createManyAndReturn, evaluate } = makeDeps();
      await service.recordMany([
        {
          userId: 'u',
          action: 'CREATE',
          entityType: 'AccessRecertificationItem',
          entityId: 'i-1',
        },
        {
          userId: 'u',
          action: 'CREATE',
          entityType: 'AccessRecertificationItem',
          entityId: 'i-2',
        },
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for an empty list — no DB call', async () => {
      const { service, createManyAndReturn, evaluate } = makeDeps();
      await service.recordMany([]);
      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(evaluate).not.toHaveBeenCalled();
    });
  });

  describe('getRetentionCutoffDate', () => {
    it('returns null when no schedule has been seeded', async () => {
      const { service } = makeDeps({ retentionScheduleItem: null });
      await expect(service.getRetentionCutoffDate()).resolves.toBeNull();
    });

    it('returns now minus the seeded retention period', async () => {
      const { service } = makeDeps({
        retentionScheduleItem: { retentionPeriodMonths: 12 },
      });
      const before = new Date();
      const cutoff = await service.getRetentionCutoffDate();
      expect(cutoff).not.toBeNull();
      const expected = new Date(before);
      expected.setUTCMonth(expected.getUTCMonth() - 12);
      // Allow a small delta for test execution time.
      expect(Math.abs(cutoff!.getTime() - expected.getTime())).toBeLessThan(
        5000,
      );
    });
  });

  it('STORES the roles the actor held, so a later rename cannot rewrite history', async () => {
    const { service, orgContext, create } = makeDeps();

    await orgContext.runForRequest(async () => {
      orgContext.adoptActorRoles(['role-triage'], ['Claims Triage Desk']);
      await service.record({
        userId: 'user-1',
        action: 'UPDATE',
        entityType: 'Claim',
        entityId: 'claim-1',
      });
    });

    const written = writtenRow(create);
    expect(written.actorRoleIds).toEqual(['role-triage']);
    // The NAME as it stood. An office renaming this role must not retroactively relabel the
    // entry — "approved by Claims Triage Desk" cannot silently become something else — which is
    // only possible because the label was copied rather than joined.
    expect(written.actorRoleNames).toEqual(['Claims Triage Desk']);
  });

  it('writes an EMPTY pair when there is no authenticated actor, rather than inventing one', async () => {
    // A scheduled sweep or a seed. Empty says "held no role"; resolving it later from the user's
    // present assignments is exactly the defect this field removes.
    const { service, create } = makeDeps();

    await service.record({
      userId: 'system-1',
      action: 'CREATE',
      entityType: 'Claim',
      entityId: 'claim-2',
    });

    const written = writtenRow(create);
    expect(written.actorRoleIds).toEqual([]);
    expect(written.actorRoleNames).toEqual([]);
  });

  it('stores the roles on the BULK path too, which is where a forgotten field hides', async () => {
    const { service, orgContext, createManyAndReturn } = makeDeps();

    await orgContext.runForRequest(async () => {
      orgContext.adoptActorRoles(
        ['role-a', 'role-b'],
        ['Compliance Officer', 'DPO'],
      );
      await service.recordMany([
        { userId: 'user-1', action: 'CREATE', entityType: 'X', entityId: '1' },
        { userId: 'user-1', action: 'CREATE', entityType: 'X', entityId: '2' },
      ]);
    });

    for (const row of writtenRows(createManyAndReturn)) {
      expect(row.actorRoleIds).toEqual(['role-a', 'role-b']);
      expect(row.actorRoleNames).toEqual(['Compliance Officer', 'DPO']);
    }
  });

  it('EVERY writer on this service stores the actor roles — the whole set, not the two tested above', () => {
    // There are three writers (`record`, `recordMany`, `recordInTransaction`) and a fourth is a
    // plausible addition — `recordInTransaction` was itself added later, for
    // `WorkflowTransitionService.transition()`, which means every workflow status change in the
    // system goes through it. A writer that forgets the actor roles produces entries that look
    // complete and are not, and nothing else would notice: the column has a default of `{}`.
    //
    // So this asserts the SET rather than adding a third example. Reads the service's own source,
    // because the alternative is remembering.
    const src = fs.readFileSync(
      path.join(__dirname, 'audit.service.ts'),
      'utf8',
    );
    const writers = [
      ...src.matchAll(/auditLogEntry\.(create|createManyAndReturn)\(/g),
    ];
    expect(writers.length).toBeGreaterThanOrEqual(3);

    for (const w of writers) {
      // The payload of this call: from the match to the matching close of its `data:` object is
      // more parsing than this needs — the actor spread appears within 600 characters of every
      // writer, and a writer that does not have it within its own call body has not got it.
      const body = src.slice(w.index, w.index + 600);
      // `String.fromCharCode(10)` rather than a newline escape: this file is edited through
      // tooling that has collapsed that escape twice, silently producing a literal line break
      // inside the template and a syntax error. Not elegant; it cannot be mis-transcribed.
      const lineNo = src
        .slice(0, w.index)
        .split(String.fromCharCode(10)).length;
      expect(
        /\.\.\.(this\.)?actorRoles(\(\))?/.test(body),
        `audit.service.ts:${lineNo} — this auditLogEntry writer does not spread the actor roles, so entries it writes would silently carry the empty default and read as "held no role"`,
      ).toBe(true);
    }
  });
});
