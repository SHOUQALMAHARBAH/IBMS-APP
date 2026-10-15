import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RetentionScheduleService } from './retention-schedule.service';
import type { RetentionScheduleRepository } from '../../repositories/retention-schedule.repository';
import type { AuditService } from '../audit/audit.service';
import {
  combinedOfficeDutySegregation,
  segregatedOfficeDutySegregation,
} from '../duty-segregation/duty-segregation.double';
import type { DutySegregationService } from '../duty-segregation/duty-segregation.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'rsi-1',
  recordCategory: 'AuditLogEntry',
  retentionPeriodMonths: 120,
  legalBasis: 'DRAFT',
  confirmedByLegalCounselAt: null,
  ...over,
});

function makeService(
  over: {
    repo?: Record<string, unknown>;
    dutySegregation?: DutySegregationService;
  } = {},
) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findByRecordCategory: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([row()]),
    update: vi
      .fn()
      .mockImplementation((id: string, data: Record<string, unknown>) =>
        Promise.resolve(row({ id, ...data })),
      ),
    confirm: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  /*
   * MODULE 0 CLOSE, DECISION 3 — THE SHARED DOUBLE, never a local `mockResolvedValue(null)`.
   *
   * Every existing assertion in this file is about an ordinary two-person act, and a local mock
   * returning null would make them all pass ON THE MOCK rather than on the code — the trap the
   * shared double was built for when fifteen service specs gained this dependency at once.
   * `segregatedOfficeDutySegregation()` refuses exactly as a segregated office does, through the
   * same `assertDifferentActors`.
   */
  const service = new RetentionScheduleService(
    repo as unknown as RetentionScheduleRepository,
    audit as unknown as AuditService,
    over.dutySegregation ?? segregatedOfficeDutySegregation(),
  );
  return { service, repo, audit };
}

describe('RetentionScheduleService.create', () => {
  it('creates a schedule item and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      {
        recordCategory: 'AuditLogEntry',
        retentionPeriodMonths: 120,
        legalBasis: 'DRAFT',
      },
      'u-compliance',
    );
    expect(v.recordCategory).toBe('AuditLogEntry');
    expect(repo.create).toHaveBeenCalledWith({
      recordCategory: 'AuditLogEntry',
      retentionPeriodMonths: 120,
      legalBasis: 'DRAFT',
      // MODULE 0 CLOSE, DECISION 3 — the MAKER is stamped, and asserting it here is what makes the
      // pair enforceable at all: a row with no maker is a row the confirmation cannot be compared
      // against. `u-compliance` — the actor THIS test passes, not the confirm test's actor.
      setByUserId: 'u-compliance',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'RetentionScheduleItem',
      }),
    );
  });

  it('409s a duplicate record category (the real unique constraint)', async () => {
    const { service } = makeService({
      repo: { create: vi.fn().mockRejectedValue(p2002()) },
    });
    await expect(
      service.create(
        { recordCategory: 'AuditLogEntry', retentionPeriodMonths: 120 },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RetentionScheduleService.update', () => {
  it('updates a not-yet-confirmed item', async () => {
    const { service, repo } = makeService();
    await service.update(
      'rsi-1',
      { retentionPeriodMonths: 84 },
      'u-compliance',
    );
    expect(repo.update).toHaveBeenCalledWith('rsi-1', {
      retentionPeriodMonths: 84,
      legalBasis: undefined,
      // RE-STAMPED ON EDIT, not carried forward. Otherwise A could create, B edit the figure, and B
      // confirm their own figure — a self-confirmation the constraint could not see, because it
      // would be comparing the checker against A.
      setByUserId: 'u-compliance',
    });
  });

  it('422s an attempt to edit an already-confirmed item', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ confirmedByLegalCounselAt: new Date() })),
      },
    });
    await expect(
      service.update('rsi-1', { retentionPeriodMonths: 84 }, 'u-compliance'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('404s an unknown item', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { retentionPeriodMonths: 84 }, 'u-compliance'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RetentionScheduleService.confirm', () => {
  it('stamps confirmedByLegalCounselAt', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValueOnce(
            row({
              confirmedByLegalCounselAt: new Date('2026-09-14T00:00:00.000Z'),
            }),
          ),
      },
    });
    const v = await service.confirm('rsi-1', 'u-dpo');
    expect(v.isConfirmed).toBe(true);
    /*
     * FOUR ARGUMENTS NOW, and the last two are the point. The ACTOR is what the date never had, and
     * the escape column is `null` for an ordinary two-person confirmation — asserted as null rather
     * than ignored, because a spurious act id would mean the engine had silently treated this as a
     * declared combined act.
     */
    expect(repo.confirm).toHaveBeenCalledWith(
      'rsi-1',
      expect.any(Date),
      'u-dpo',
      null,
    );
  });

  it('carries the act id the ENGINE returned into the write, when the office has declared merged duties', async () => {
    /*
     * THE TEST THE PREVIOUS ONE COULD NOT BE — § 1.51(d), found by a plant that killed nothing.
     *
     * The ordinary-path test asserts the fourth argument is `null`. A plant replacing
     * `combinedDutyActId` with a literal `null` left it GREEN, because in a segregated office the
     * engine returns null and the two are observationally identical. So the assertion could not
     * tell the engine's result from a hardcoded value — which is the whole thing it exists to check.
     *
     * Only a COMBINED office distinguishes them: here the maker and the checker are the same person,
     * the office has declared merged duties, and the engine returns an act id that the write MUST
     * carry. Without it the database CHECK refuses the row — so dropping the engine's return value
     * turns a legitimate declared act into a 500, which is the backstop working and not a reason to
     * leave the service free to forget.
     */
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ setByUserId: 'u-solo' }))
          .mockResolvedValueOnce(
            row({
              setByUserId: 'u-solo',
              confirmedByLegalCounselAt: new Date('2026-09-14T00:00:00.000Z'),
            }),
          ),
      },
      dutySegregation: combinedOfficeDutySegregation('act-xyz'),
    });

    await service.confirm('rsi-1', 'u-solo', {
      combinedDutyReason:
        'Sole officer in this office; declared merged duties.',
    });

    expect(repo.confirm).toHaveBeenCalledWith(
      'rsi-1',
      expect.any(Date),
      'u-solo',
      'act-xyz',
    );
  });

  it('422s a re-confirm of an already-confirmed item', async () => {
    const { service } = makeService({
      repo: {
        confirm: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValue(row({ confirmedByLegalCounselAt: new Date() })),
      },
    });
    await expect(service.confirm('rsi-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('409s a genuine concurrent-change race (0 rows, still unconfirmed on reload)', async () => {
    const { service } = makeService({
      repo: {
        confirm: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi.fn().mockResolvedValue(row()),
      },
    });
    await expect(service.confirm('rsi-1', 'u-dpo')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('RetentionScheduleService reads', () => {
  it('lists every schedule item', async () => {
    const { service, repo } = makeService();
    const rows = await service.list();
    expect(rows).toHaveLength(1);
    expect(repo.findMany).toHaveBeenCalled();
  });

  it('404s an unknown item on get', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
