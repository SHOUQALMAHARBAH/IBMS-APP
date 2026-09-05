import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { InsurerPerformanceScore } from '@ibms/db';
import { InsurerPerformanceService } from './insurer-performance.service';
import type {
  InsurerPerformanceRepository,
  InsurerPerformanceScoreInput,
} from '../../repositories/insurer-performance.repository';
import type { AuditService } from '../audit/audit.service';
import type { PeriodWindow } from './insurer-performance.config';

/** The `InsurerPerformanceScoreInput` `upsertScore` was called with — typed
 * so an assertion on it isn't an unsafe `any` member access. */
function upsertedScores(repo: {
  upsertScore: ReturnType<typeof vi.fn>;
}): InsurerPerformanceScoreInput {
  return repo.upsertScore.mock.calls[0][2] as InsurerPerformanceScoreInput;
}

const PERIOD: PeriodWindow = {
  periodLabel: '2026-08',
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
};

const SCORE_ROW: InsurerPerformanceScore = {
  id: 'score-1',
  insurerId: 'insurer-1',
  periodLabel: '2026-08',
  quoteResponseScore: new Prisma.Decimal('50'),
  claimsServiceScore: new Prisma.Decimal('50'),
  priceScore: new Prisma.Decimal('50'),
  serviceQualityScore: new Prisma.Decimal('50'),
  computedAt: new Date('2026-09-01T06:00:00.000Z'),
};

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    listInsurerIds: vi.fn().mockResolvedValue([{ id: 'insurer-1' }]),
    findSlaTargetDays: vi.fn().mockResolvedValue(null),
    findRespondedRfqInsurers: vi.fn().mockResolvedValue([]),
    countClaims: vi.fn().mockResolvedValue(0),
    countClaimsWithNoFollowUpAlert: vi.fn().mockResolvedValue(0),
    findCurrentQuotationsInWindow: vi.fn().mockResolvedValue([]),
    findCompetingCurrentPremiums: vi.fn().mockResolvedValue([]),
    findServiceScores: vi.fn().mockResolvedValue([]),
    upsertScore: vi
      .fn()
      .mockResolvedValue({ row: SCORE_ROW, wasCreated: true }),
    findMany: vi.fn().mockResolvedValue([SCORE_ROW]),
    findLatest: vi.fn().mockResolvedValue(SCORE_ROW),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new InsurerPerformanceService(
    repo as unknown as InsurerPerformanceRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('InsurerPerformanceService.computeScoreForInsurer', () => {
  it('defaults every dimension to the neutral score when no data exists for the period', async () => {
    const { service, repo } = makeService();
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    expect(repo.upsertScore).toHaveBeenCalledWith(
      'insurer-1',
      '2026-08',
      expect.anything(),
    );
    const call = upsertedScores(repo);
    expect(call.quoteResponseScore.toString()).toBe('50');
    expect(call.claimsServiceScore.toString()).toBe('50');
    expect(call.priceScore.toString()).toBe('50');
    expect(call.serviceQualityScore.toString()).toBe('50');
  });

  it("scores quote-response speed against the insurer's own SLA target when one exists", async () => {
    const { service, repo } = makeService({
      repo: {
        findSlaTargetDays: vi.fn().mockResolvedValue(6),
        findRespondedRfqInsurers: vi.fn().mockResolvedValue([
          {
            sentAt: new Date('2026-08-01T00:00:00.000Z'),
            respondedAt: new Date('2026-08-07T00:00:00.000Z'),
          },
        ]),
      },
    });
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    expect(repo.findSlaTargetDays).toHaveBeenCalledWith(
      'insurer-1',
      'quote_response',
    );
    const call = upsertedScores(repo);
    // 6-day target vs. a 6-day actual response -> 100
    expect(call.quoteResponseScore.toString()).toBe('100');
  });

  it('falls back to the 9-day default when no SLA agreement exists', async () => {
    const { service, repo } = makeService({
      repo: {
        findSlaTargetDays: vi.fn().mockResolvedValue(null),
        findRespondedRfqInsurers: vi.fn().mockResolvedValue([
          {
            sentAt: new Date('2026-08-01T00:00:00.000Z'),
            respondedAt: new Date('2026-08-19T00:00:00.000Z'),
          },
        ]),
      },
    });
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    const call = upsertedScores(repo);
    // 9-day default vs. an 18-day actual response -> 50
    expect(call.quoteResponseScore.toString()).toBe('50');
  });

  it('scores claims service as the proportion of claims with no follow-up alert', async () => {
    const { service, repo } = makeService({
      repo: {
        countClaims: vi.fn().mockResolvedValue(4),
        countClaimsWithNoFollowUpAlert: vi.fn().mockResolvedValue(3),
      },
    });
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    const call = upsertedScores(repo);
    expect(call.claimsServiceScore.toString()).toBe('75');
  });

  it('scores price competitiveness against the field average, skipping RFQs with no competing quote', async () => {
    const { service, repo } = makeService({
      repo: {
        findCurrentQuotationsInWindow: vi.fn().mockResolvedValue([
          { id: 'q1', rfqId: 'rfq-1', premium: '900.000' },
          { id: 'q2', rfqId: 'rfq-2', premium: '1000.000' },
        ]),
        findCompetingCurrentPremiums: vi
          .fn()
          .mockImplementation((rfqId: string) =>
            Promise.resolve(rfqId === 'rfq-1' ? ['1000.000'] : []),
          ),
      },
    });
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    // rfq-1: 1000/900*100 = 111.11 -> capped 100; rfq-2 has no competitor, skipped
    const call = upsertedScores(repo);
    expect(call.priceScore.toString()).toBe('100');
  });

  it('averages the subjective service scores supplied for the period', async () => {
    const { service, repo } = makeService({
      repo: { findServiceScores: vi.fn().mockResolvedValue(['80', '60']) },
    });
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    const call = upsertedScores(repo);
    expect(call.serviceQualityScore.toString()).toBe('70');
  });

  it('writes a CREATE audit row on first compute and UPDATE on a recompute', async () => {
    const { service, audit } = makeService();
    await service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'InsurerPerformanceScore',
      }),
    );

    const { service: service2, audit: audit2 } = makeService({
      repo: {
        upsertScore: vi
          .fn()
          .mockResolvedValue({ row: SCORE_ROW, wasCreated: false }),
      },
    });
    await service2.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1');
    expect(audit2.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'InsurerPerformanceScore',
      }),
    );
  });

  it('does not fail the compute if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.computeScoreForInsurer('insurer-1', PERIOD, 'actor-1'),
    ).resolves.toBeDefined();
  });
});

describe('InsurerPerformanceService.computeScores', () => {
  it('scores every insurer, isolating one failure from the rest', async () => {
    const { service, repo } = makeService({
      repo: {
        listInsurerIds: vi
          .fn()
          .mockResolvedValue([{ id: 'insurer-1' }, { id: 'insurer-2' }]),
        upsertScore: vi
          .fn()
          .mockImplementationOnce(() => Promise.reject(new Error('db hiccup')))
          .mockImplementationOnce(() =>
            Promise.resolve({ row: SCORE_ROW, wasCreated: true }),
          ),
      },
    });
    const result = await service.computeScores(PERIOD, 'actor-1');
    expect(result).toEqual({
      periodLabel: '2026-08',
      insurersComputed: 1,
      insurersFailed: 1,
    });
    expect(repo.upsertScore).toHaveBeenCalledTimes(2);
  });
});

describe('InsurerPerformanceService.list / latest', () => {
  it('list() passes filters through and derives the view', async () => {
    const { service, repo } = makeService();
    const rows = await service.list({ insurerId: 'insurer-1' });
    expect(repo.findMany).toHaveBeenCalledWith({
      insurerId: 'insurer-1',
      periodLabel: undefined,
    });
    expect(rows[0].id).toBe('score-1');
  });

  it('latest() 404s when no score has ever been computed', async () => {
    const { service } = makeService({
      repo: { findLatest: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.latest('insurer-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('InsurerPerformanceService.resolvePeriodFromDto', () => {
  it('defaults to the previous UTC calendar month when every period field is omitted', () => {
    const { service } = makeService();
    const period = service.resolvePeriodFromDto({ insurerId: 'insurer-1' });
    expect(period.periodLabel).toMatch(/^\d{4}-\d{2}$/);
  });

  it('accepts an explicit period when all three fields are supplied', () => {
    const { service } = makeService();
    const period = service.resolvePeriodFromDto({
      insurerId: 'insurer-1',
      periodLabel: '2026-01',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
    });
    expect(period.periodLabel).toBe('2026-01');
    expect(period.periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('422s a partial override', () => {
    const { service } = makeService();
    expect(() =>
      service.resolvePeriodFromDto({
        insurerId: 'insurer-1',
        periodLabel: '2026-01',
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('422s periodEnd at or before periodStart', () => {
    const { service } = makeService();
    expect(() =>
      service.resolvePeriodFromDto({
        insurerId: 'insurer-1',
        periodLabel: '2026-01',
        periodStart: '2026-02-01',
        periodEnd: '2026-01-01',
      }),
    ).toThrow(UnprocessableEntityException);
  });
});
