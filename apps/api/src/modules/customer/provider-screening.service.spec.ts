import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  ProviderScreeningService,
  aggregateOutcome,
  bandFor,
  buildIdempotencyKey,
  idempotencyBucket,
} from './provider-screening.service';
import type { ProviderScreeningResult } from '../screening-providers/screening-provider.types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScreeningProviderRegistry } from '../screening-providers/screening-provider.registry';

function result(
  outcome: ProviderScreeningResult['outcome'],
  candidateCount = 0,
): ProviderScreeningResult {
  return {
    outcome,
    candidates: Array.from({ length: candidateCount }, (_, i) => ({
      providerEntityId: `e-${i}`,
      entityName: 'SOMEBODY',
      entityType: 'individual' as const,
      listType: 'SANCTIONS' as const,
      score: 0.9,
      matchedAttributes: ['name' as const],
      sourceList: 'TEST',
    })),
    provider: 'built_in',
    providerName: 'test',
    correlationId: 'c',
    durationMs: 1,
  };
}

describe('aggregating outcomes across the subjects of one KYC file', () => {
  // The precedence is the safe direction at every step. A KYC file covers the
  // customer AND every UBO; if even one of them could not be screened, the
  // FILE has not been screened.

  it('one unscreenable subject makes the whole file unscreenable', () => {
    // The failure this ordering exists to prevent: reporting a customer clear
    // because their other UBOs came back clean.
    expect(
      aggregateOutcome([result('NO_MATCH'), result('SCREENING_FAILED')]),
    ).toBe('SCREENING_FAILED');
    expect(
      aggregateOutcome([result('NO_MATCH'), result('NOT_CONFIGURED')]),
    ).toBe('NOT_CONFIGURED');
    expect(
      aggregateOutcome([result('NO_MATCH'), result('UNABLE_TO_SCREEN')]),
    ).toBe('UNABLE_TO_SCREEN');
  });

  it('an unresolved subject outranks even a potential match', () => {
    // Both escalate, but the reason matters: "we found something" and "we
    // could not look" call for different follow-up.
    expect(
      aggregateOutcome([
        result('POTENTIAL_MATCH', 1),
        result('SCREENING_FAILED'),
      ]),
    ).toBe('SCREENING_FAILED');
  });

  it('a potential match outranks a clear one', () => {
    expect(
      aggregateOutcome([result('NO_MATCH'), result('POTENTIAL_MATCH', 1)]),
    ).toBe('POTENTIAL_MATCH');
  });

  it('every subject clear is the only route to NO_MATCH', () => {
    expect(aggregateOutcome([result('NO_MATCH'), result('NO_MATCH')])).toBe(
      'NO_MATCH',
    );
  });

  it('no subjects at all is UNABLE_TO_SCREEN, not a vacuous clear', () => {
    // An empty subject set means nothing was checked. Returning NO_MATCH here
    // would be the emptiest possible false assurance.
    expect(aggregateOutcome([])).toBe('UNABLE_TO_SCREEN');
  });
});

describe('threshold banding', () => {
  const thresholds = { high: 0.9, review: 0.7, low: 0.5 };

  it('bands by the CONFIGURED values, not a hard-coded figure', () => {
    expect(bandFor(0.95, thresholds)).toBe('high');
    expect(bandFor(0.9, thresholds)).toBe('high'); // inclusive
    expect(bandFor(0.8, thresholds)).toBe('review');
    expect(bandFor(0.7, thresholds)).toBe('review'); // inclusive
    expect(bandFor(0.6, thresholds)).toBe('below');
  });

  it('follows a different configuration', () => {
    const strict = { high: 0.99, review: 0.95, low: 0.9 };
    expect(bandFor(0.95, strict)).toBe('review');
    expect(bandFor(0.8, strict)).toBe('below');
  });

  it('a review threshold of 0 queues everything', () => {
    expect(bandFor(0, { high: 1, review: 0, low: 0 })).toBe('review');
  });
});

describe('idempotency key', () => {
  const subjects = [
    {
      subjectRef: 'a',
      fullName: 'Ahmad Al Hashimi',
      entityType: 'individual' as const,
    },
    {
      subjectRef: 'b',
      fullName: 'Acme Ltd',
      entityType: 'organization' as const,
    },
  ];

  it('is stable for the same screening', () => {
    const a = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    const b = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    expect(a).toBe(b);
  });

  it('ignores subject ORDER — the same people are the same screening', () => {
    const forward = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    const reversed = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects: [...subjects].reverse(),
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    expect(forward).toBe(reversed);
  });

  it('changes when the SUBJECTS change — a new UBO is a new screening', () => {
    const withExtra = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects: [
        ...subjects,
        {
          subjectRef: 'c',
          fullName: 'New Person',
          entityType: 'individual' as const,
        },
      ],
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    const without = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    expect(withExtra).not.toBe(without);
  });

  it('changes when the PROVIDER changes — a different source is a different answer', () => {
    expect(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'built_in',
        dataset: null,
        bucket: 1,
      }),
    ).not.toBe(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'commercial',
        dataset: null,
        bucket: 1,
      }),
    );
  });

  it('changes when the DATASET changes', () => {
    expect(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'on_premise',
        dataset: 'default',
        bucket: 1,
      }),
    ).not.toBe(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'on_premise',
        dataset: 'sanctions-only',
        bucket: 1,
      }),
    );
  });

  it('does NOT expose the screened names — they are Highly Confidential', () => {
    // The key sits in a queryable column. It must not be a readable list of
    // the people screened; the KYC id stays in the clear so the row is still
    // traceable to its file.
    const key = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
      bucket: 1,
    });
    expect(key).toMatch(/^kyc-1:[0-9a-f]{32}$/);
    expect(key).not.toContain('Ahmad');
    expect(key).not.toContain('Acme');
  });
});

describe('REGRESSION: the recurring batch has to actually re-screen', () => {
  // The bug: `buildIdempotencyKey` was derived from the KYC file, the subject
  // set, the provider and the dataset — with nothing time-varying in it. So
  // the SECOND time the 4-hourly batch reached a customer, `execute()` found
  // the original attempt and returned it without calling the provider. For
  // `built_in` that was masked, because the real list check runs separately
  // against the local cache. For `on_premise` and `commercial`, where the
  // provider IS the only source, ongoing monitoring stopped dead after each
  // customer's first screening — which is the entire point of the batch.
  //
  // Proven before it was fixed: the second run reported
  // `idempotentResume: true` with the provider called exactly once.

  function harness(windowMinutes = 15) {
    const screenBatch = vi.fn().mockResolvedValue([
      {
        outcome: 'NO_MATCH',
        candidates: [],
        provider: 'commercial',
        providerName: 'X',
        correlationId: 'c',
        durationMs: 1,
      },
    ]);

    const rows = new Map<string, Record<string, unknown>>();
    const create = vi.fn(({ data }: { data: Record<string, unknown> }) => {
      const key = data.idempotencyKey as string;
      if (rows.has(key)) {
        // What Postgres does with the UNIQUE on `idempotencyKey`.
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      }
      const row = {
        id: `r${rows.size}`,
        correlationId: 'c',
        outcome: 'NO_MATCH',
        provider: 'commercial',
        providerName: 'X',
        datasetVersion: null,
        failureReason: null,
        ...data,
      };
      rows.set(key, row);
      return Promise.resolve(row);
    });

    const prisma = {
      client: {
        screeningRequest: {
          findUnique: vi.fn(
            ({ where }: { where: { idempotencyKey: string } }) =>
              Promise.resolve(rows.get(where.idempotencyKey) ?? null),
          ),
          create,
        },
      },
    } as unknown as PrismaService;

    const registry = {
      resolve: () => ({ kind: 'commercial', name: 'X', screenBatch }),
      config: () => ({
        dataset: 'sanctions',
        idempotencyWindowMinutes: windowMinutes,
      }),
      thresholds: () => ({ high: 0.9, review: 0.7, low: 0.5 }),
      newCorrelationId: () => 'corr',
    } as unknown as ScreeningProviderRegistry;

    return {
      service: new ProviderScreeningService(prisma, registry),
      screenBatch,
      create,
      rows,
    };
  }

  const input = {
    kycRecordId: 'kyc-1',
    subjects: [
      {
        subjectRef: 'customer:c1',
        fullName: 'Sami Al-Rashid',
        entityType: 'individual' as const,
      },
    ],
    requestedByUserId: 'u1',
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the provider again four hours later', async () => {
    const { service, screenBatch } = harness();
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    expect((await service.execute(input)).idempotentResume).toBe(false);

    // The recurring batch, one cadence later.
    vi.setSystemTime(new Date('2026-09-10T04:00:00Z'));
    const second = await service.execute(input);

    expect(second.idempotentResume).toBe(false);
    expect(screenBatch).toHaveBeenCalledTimes(2);
  });

  it('still resumes an immediate retry — the reason the key exists', async () => {
    const { service, screenBatch } = harness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));

    await service.execute(input);
    // A duplicated request seconds later must NOT mint a second set of
    // compliance cases.
    vi.setSystemTime(new Date('2026-09-10T00:00:20Z'));
    const retry = await service.execute(input);

    expect(retry.idempotentResume).toBe(true);
    expect(screenBatch).toHaveBeenCalledTimes(1);
  });

  it('honours a configured window', async () => {
    const { service, screenBatch } = harness(60);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    await service.execute(input);

    // 30 minutes on, inside a 60-minute window: still a repeat.
    vi.setSystemTime(new Date('2026-09-10T00:30:00Z'));
    expect((await service.execute(input)).idempotentResume).toBe(true);
    expect(screenBatch).toHaveBeenCalledTimes(1);
  });

  it('a changed subject set re-screens immediately, window or not', async () => {
    // A UBO added seconds after a screening is a different screening.
    const { service, screenBatch } = harness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    await service.execute(input);

    const withUbo = {
      ...input,
      subjects: [
        ...input.subjects,
        {
          subjectRef: 'ubo:u1',
          fullName: 'Layla Haddad',
          entityType: 'individual' as const,
        },
      ],
    };
    expect((await service.execute(withUbo)).idempotentResume).toBe(false);
    expect(screenBatch).toHaveBeenCalledTimes(2);
  });
});

describe('REGRESSION: the UNIQUE constraint is the guarantee, so P2002 must resume', () => {
  // The comment said "A UNIQUE constraint on the key is what enforces it; the
  // read below is an optimisation, not the guarantee" — and nothing caught the
  // constraint firing. Two concurrent requests both found nothing, both
  // inserted, and the loser threw an unhandled P2002: a 500 for a screening
  // that had in fact just succeeded.
  it('the loser of a concurrent insert resumes the winner instead of throwing', async () => {
    const screenBatch = vi.fn().mockResolvedValue([
      {
        outcome: 'NO_MATCH',
        candidates: [],
        provider: 'commercial',
        providerName: 'X',
        correlationId: 'c',
        durationMs: 1,
      },
    ]);

    const winner = {
      id: 'winner',
      correlationId: 'winner-corr',
      outcome: 'NO_MATCH',
      provider: 'commercial',
      providerName: 'X',
      datasetVersion: null,
      failureReason: null,
    };

    let readCount = 0;
    const prisma = {
      client: {
        screeningRequest: {
          // First read (the fast path) sees nothing — the winner has not
          // committed yet. The read AFTER the P2002 sees it.
          findUnique: vi.fn(() =>
            Promise.resolve(readCount++ === 0 ? null : winner),
          ),
          create: vi.fn(() =>
            Promise.reject(
              new Prisma.PrismaClientKnownRequestError('duplicate', {
                code: 'P2002',
                clientVersion: 'test',
              }),
            ),
          ),
        },
      },
    } as unknown as PrismaService;

    const registry = {
      resolve: () => ({ kind: 'commercial', name: 'X', screenBatch }),
      config: () => ({ dataset: 'sanctions', idempotencyWindowMinutes: 15 }),
      thresholds: () => ({ high: 0.9, review: 0.7, low: 0.5 }),
      newCorrelationId: () => 'loser-corr',
    } as unknown as ScreeningProviderRegistry;

    const service = new ProviderScreeningService(prisma, registry);
    const result = await service.execute({
      kycRecordId: 'kyc-1',
      subjects: [
        {
          subjectRef: 'customer:c1',
          fullName: 'Sami Al-Rashid',
          entityType: 'individual' as const,
        },
      ],
      requestedByUserId: 'u1',
    });

    expect(result.idempotentResume).toBe(true);
    expect(result.requestId).toBe('winner');
    // The caller is handed the WINNER's correlation id, not its own — that is
    // the attempt whose record actually exists.
    expect(result.correlationId).toBe('winner-corr');
  });

  it('rethrows a constraint violation it cannot resolve', async () => {
    // A P2002 on some other constraint is a real error, not an idempotent
    // repeat, and swallowing it would hide a genuine failure.
    const prisma = {
      client: {
        screeningRequest: {
          findUnique: vi.fn(() => Promise.resolve(null)),
          create: vi.fn(() =>
            Promise.reject(
              new Prisma.PrismaClientKnownRequestError('other', {
                code: 'P2002',
                clientVersion: 'test',
              }),
            ),
          ),
        },
      },
    } as unknown as PrismaService;

    const registry = {
      resolve: () => ({
        kind: 'commercial',
        name: 'X',
        screenBatch: vi.fn().mockResolvedValue([
          {
            outcome: 'NO_MATCH',
            candidates: [],
            provider: 'commercial',
            providerName: 'X',
            correlationId: 'c',
            durationMs: 1,
          },
        ]),
      }),
      config: () => ({ dataset: 'sanctions', idempotencyWindowMinutes: 15 }),
      thresholds: () => ({ high: 0.9, review: 0.7, low: 0.5 }),
      newCorrelationId: () => 'corr',
    } as unknown as ScreeningProviderRegistry;

    await expect(
      new ProviderScreeningService(prisma, registry).execute({
        kycRecordId: 'kyc-1',
        subjects: [
          {
            subjectRef: 'customer:c1',
            fullName: 'Sami Al-Rashid',
            entityType: 'individual' as const,
          },
        ],
        requestedByUserId: 'u1',
      }),
    ).rejects.toThrow();
  });
});

describe('idempotencyBucket', () => {
  it('is stable inside a window and changes across one', () => {
    const w = 15;
    const at = (iso: string) => idempotencyBucket(w, new Date(iso));
    expect(at('2026-09-10T00:00:00Z')).toBe(at('2026-09-10T00:14:59Z'));
    expect(at('2026-09-10T00:00:00Z')).not.toBe(at('2026-09-10T00:15:01Z'));
  });

  it('a 4-hour gap is always a different bucket at any sane window', () => {
    for (const w of [1, 5, 15, 60, 120]) {
      expect(
        idempotencyBucket(w, new Date('2026-09-10T00:00:00Z')),
        `window ${w}`,
      ).not.toBe(idempotencyBucket(w, new Date('2026-09-10T04:00:00Z')));
    }
  });
});
