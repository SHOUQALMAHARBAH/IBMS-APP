import { describe, expect, it, vi } from 'vitest';
import type { AuditLogEntry } from '@ibms/db';
import { AuditAnomalyDetectionService } from './audit-anomaly-detection.service';
import type { AccessAnomalyAlertRepository } from '../../repositories/access-anomaly-alert.repository';

function makeEntry(overrides?: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 'entry-1',
    userId: 'user-1',
    action: 'READ',
    entityType: 'Customer',
    entityId: 'customer-1',
    beforeValue: null,
    afterValue: null,
    isSensitiveDataAccess: false,
    // 10:00 Asia/Amman (UTC+3) — inside the business-hours window.
    occurredAt: new Date('2026-01-15T07:00:00Z'),
    ...overrides,
  };
}

function makeDeps(overrides?: {
  exportCount?: number;
  sensitiveReadIds?: string[];
  countRecentByUserAndActionImpl?: () => Promise<number>;
}): {
  service: AuditAnomalyDetectionService;
  repo: {
    create: ReturnType<typeof vi.fn>;
    countRecentByUserAndAction: ReturnType<typeof vi.fn>;
    findRecentSensitiveReadsByUserAndEntity: ReturnType<typeof vi.fn>;
  };
} {
  const create = vi.fn().mockResolvedValue(undefined);
  const countRecentByUserAndAction =
    overrides?.countRecentByUserAndActionImpl ??
    vi.fn().mockResolvedValue(overrides?.exportCount ?? 0);
  const findRecentSensitiveReadsByUserAndEntity = vi
    .fn()
    .mockResolvedValue(
      (overrides?.sensitiveReadIds ?? []).map((id) => ({ id })),
    );

  const repo = {
    create,
    countRecentByUserAndAction,
    findRecentSensitiveReadsByUserAndEntity,
  } as unknown as AccessAnomalyAlertRepository;

  return {
    service: new AuditAnomalyDetectionService(repo),
    repo: repo as unknown as {
      create: ReturnType<typeof vi.fn>;
      countRecentByUserAndAction: ReturnType<typeof vi.fn>;
      findRecentSensitiveReadsByUserAndEntity: ReturnType<typeof vi.fn>;
    },
  };
}

describe('AuditAnomalyDetectionService', () => {
  describe('bulk export', () => {
    it('creates a BULK_EXPORT alert once the threshold is crossed', async () => {
      const { service, repo } = makeDeps({ exportCount: 20 });
      await service.evaluate(makeEntry({ action: 'EXPORT' }));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          patternType: 'BULK_EXPORT',
        }),
      );
    });

    it('does not alert below the threshold', async () => {
      const { service, repo } = makeDeps({ exportCount: 19 });
      await service.evaluate(makeEntry({ action: 'EXPORT' }));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('does not check export volume for a non-EXPORT action', async () => {
      const { service, repo } = makeDeps({ exportCount: 999 });
      await service.evaluate(makeEntry({ action: 'READ' }));
      expect(repo.countRecentByUserAndAction).not.toHaveBeenCalled();
    });
  });

  describe('off-hours access', () => {
    it('flags a sensitive access outside the business-hours window', async () => {
      const { service, repo } = makeDeps();
      await service.evaluate(
        makeEntry({
          isSensitiveDataAccess: true,
          // 22:00 Asia/Amman (UTC+3) — outside 07:00-19:00.
          occurredAt: new Date('2026-01-15T19:00:00Z'),
        }),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ patternType: 'OFF_HOURS_ACCESS' }),
      );
    });

    it('does not flag a sensitive access inside the business-hours window', async () => {
      const { service, repo } = makeDeps();
      await service.evaluate(
        makeEntry({
          isSensitiveDataAccess: true,
          occurredAt: new Date('2026-01-15T07:00:00Z'), // 10:00 Asia/Amman
        }),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('does not check hours for a non-sensitive access', async () => {
      const { service, repo } = makeDeps();
      await service.evaluate(
        makeEntry({
          isSensitiveDataAccess: false,
          occurredAt: new Date('2026-01-15T19:00:00Z'),
        }),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('repeated unjustified access', () => {
    it('flags repeated sensitive access to the same entity once the threshold is crossed', async () => {
      const { service, repo } = makeDeps({
        sensitiveReadIds: ['a', 'b', 'c', 'd', 'e'],
      });
      await service.evaluate(makeEntry({ isSensitiveDataAccess: true }));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patternType: 'REPEATED_UNJUSTIFIED_ACCESS',
          relatedAuditLogEntryIds: ['a', 'b', 'c', 'd', 'e'],
        }),
      );
    });

    it('does not flag below the repeated-access threshold', async () => {
      const { service, repo } = makeDeps({
        sensitiveReadIds: ['a', 'b', 'c', 'd'],
      });
      await service.evaluate(makeEntry({ isSensitiveDataAccess: true }));
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  it('never throws when the repository fails — a detection error must not block the audit write', async () => {
    const { service, repo } = makeDeps({ exportCount: 20 });
    repo.countRecentByUserAndAction.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.evaluate(makeEntry({ action: 'EXPORT' })),
    ).resolves.toBeUndefined();
  });
});
