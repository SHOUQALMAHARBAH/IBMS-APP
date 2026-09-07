import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service';
import type { AuditAnomalyDetectionService } from './audit-anomaly-detection.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makeDeps(overrides?: {
  createdEntry?: Record<string, unknown>;
  retentionScheduleItem?: { retentionPeriodMonths: number } | null;
}): {
  service: AuditService;
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

  return {
    service: new AuditService(prisma, anomalyDetection),
    create,
    createManyAndReturn,
    findFirst,
    evaluate,
  };
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
});
