import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { WatchlistSyncService } from './watchlist-sync.service';
import type { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import type {
  OfacSdnFetcher,
  UnConsolidatedFetcher,
} from './watchlist-fetchers';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const OFAC_SAMPLE =
  '2674,"ABBAS, Abu","individual","SDGT","Director",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 10 Dec 1948."';

const UN_SAMPLE = `<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>6907993</DATAID>
      <FIRST_NAME>ERIC</FIRST_NAME>
      <SECOND_NAME>BADEGE</SECOND_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES></ENTITIES>
</CONSOLIDATED_LIST>`;

function makeService(
  over: {
    entries?: Record<string, unknown>;
    ofacRaw?: () => Promise<string>;
    unRaw?: () => Promise<string>;
  } = {},
) {
  const createSyncRun = vi
    .fn()
    .mockImplementation((source: string) =>
      Promise.resolve({ id: `run-${source}`, source }),
    );
  const completeSyncRun = vi.fn().mockResolvedValue(undefined);
  const upsertMany = vi.fn().mockResolvedValue(undefined);
  const pruneStale = vi.fn().mockResolvedValue({ count: 0 });
  const findLatestSyncRuns = vi.fn().mockResolvedValue([]);
  // Defaults to a prior run of 1 record (not `null`/"no prior sync") so the
  // plausibility floor (`floor(1 * WATCHLIST_MIN_ACCEPTABLE_RATIO) === 0`)
  // never blocks the 1-record OFAC_SAMPLE/UN_SAMPLE fixtures below by
  // default — tests targeting the floor itself override this explicitly.
  const findLastSuccessfulRun = vi.fn().mockResolvedValue({ recordCount: 1 });
  const entries = {
    createSyncRun,
    completeSyncRun,
    upsertMany,
    pruneStale,
    findLatestSyncRuns,
    findLastSuccessfulRun,
    ...over.entries,
  } as unknown as WatchlistEntryRepository;

  const ofac = {
    fetchRaw: over.ofacRaw ?? (() => Promise.resolve(OFAC_SAMPLE)),
  } as unknown as OfacSdnFetcher;
  const un = {
    fetchRaw: over.unRaw ?? (() => Promise.resolve(UN_SAMPLE)),
  } as unknown as UnConsolidatedFetcher;

  const service = new WatchlistSyncService(entries, ofac, un);
  return {
    service,
    mocks: {
      createSyncRun,
      completeSyncRun,
      upsertMany,
      pruneStale,
      findLatestSyncRuns,
      findLastSuccessfulRun,
    },
  };
}

describe('WatchlistSyncService.runSync (Process 49)', () => {
  it('syncs both sources: creates a run, upserts parsed records, prunes stale ones, marks succeeded', async () => {
    const { service, mocks } = makeService();

    const outcomes = await service.runSync();

    expect(outcomes).toEqual([
      { source: 'OFAC_SDN', status: 'succeeded', recordCount: 1 },
      { source: 'UN_CONSOLIDATED', status: 'succeeded', recordCount: 1 },
    ]);
    expect(mocks.createSyncRun).toHaveBeenCalledWith('OFAC_SDN');
    expect(mocks.createSyncRun).toHaveBeenCalledWith('UN_CONSOLIDATED');
    expect(mocks.upsertMany).toHaveBeenCalledWith(
      'OFAC_SDN',
      'run-OFAC_SDN',
      expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: '2674' }),
      ]),
    );
    expect(mocks.pruneStale).toHaveBeenCalledWith('OFAC_SDN', 'run-OFAC_SDN');
    expect(mocks.completeSyncRun).toHaveBeenCalledWith('run-OFAC_SDN', {
      recordCount: 1,
    });
  });

  it('stamps normalizedName on every upserted record', async () => {
    const { service, mocks } = makeService();

    await service.runSync();

    const [, , records] = mocks.upsertMany.mock.calls[0] as [
      string,
      string,
      { normalizedName: string }[],
    ];
    expect(records[0].normalizedName).toBe('ABBAS ABU');
  });

  it('one source failing does not block the other (per-source isolation)', async () => {
    const { service, mocks } = makeService({
      ofacRaw: () => Promise.reject(new Error('OFAC unreachable')),
    });

    const outcomes = await service.runSync();

    const ofacOutcome = outcomes.find((o) => o.source === 'OFAC_SDN')!;
    const unOutcome = outcomes.find((o) => o.source === 'UN_CONSOLIDATED')!;
    expect(ofacOutcome.status).toBe('failed');
    expect(ofacOutcome.errorMessage).toBe('OFAC unreachable');
    expect(unOutcome.status).toBe('succeeded');
    expect(mocks.completeSyncRun).toHaveBeenCalledWith('run-OFAC_SDN', {
      errorMessage: 'OFAC unreachable',
    });
    // A failed fetch never reaches upsert/prune for that source.
    expect(mocks.upsertMany).not.toHaveBeenCalledWith(
      'OFAC_SDN',
      expect.anything(),
      expect.anything(),
    );
  });

  it('findLatestSyncRuns delegates to the repository', async () => {
    const { service, mocks } = makeService();
    await service.findLatestSyncRuns();
    expect(mocks.findLatestSyncRuns).toHaveBeenCalled();
  });

  // A @code-reviewer BLOCKER on the first pass: a concurrent sync of the
  // SAME source (the 12-hourly scheduler overlapping a manual trigger, or
  // two manual triggers) had no guard — createSyncRun's P2002 (the partial
  // UNIQUE ... WHERE status='running') must be treated as a benign
  // "already running" outcome, not an unhandled rejection.
  it('a concurrent sync of the same source (P2002 on createSyncRun) is skipped, not thrown', async () => {
    const { service, mocks } = makeService({
      entries: {
        createSyncRun: vi.fn().mockRejectedValue(p2002()),
      },
    });

    const outcomes = await service.runSync();

    for (const outcome of outcomes) {
      expect(outcome.status).toBe('skipped');
      expect(outcome.errorMessage).toBe(
        'a sync for this source is already running',
      );
    }
    expect(mocks.upsertMany).not.toHaveBeenCalled();
    expect(mocks.completeSyncRun).not.toHaveBeenCalled();
  });

  it('a non-P2002 createSyncRun failure still throws (not silently skipped)', async () => {
    const { service } = makeService({
      entries: {
        createSyncRun: vi.fn().mockRejectedValue(new Error('DB is down')),
      },
    });

    await expect(service.runSync()).rejects.toThrow('DB is down');
  });

  // A @code-reviewer BLOCKER on the first pass: a 200 response carrying the
  // wrong content (a WAF/interstitial page, a changed redirect target)
  // parses to near-zero records without ever throwing — nothing distinguished
  // that from a genuine list shrink, so `pruneStale` would wipe out the
  // entire prior cache for that source.
  it('a parse implausibly smaller than the last successful sync fails without pruning', async () => {
    const { service, mocks } = makeService({
      entries: {
        findLastSuccessfulRun: vi.fn().mockResolvedValue({ recordCount: 1000 }),
      },
    });

    const outcomes = await service.runSync();

    const ofacOutcome = outcomes.find((o) => o.source === 'OFAC_SDN')!;
    expect(ofacOutcome.status).toBe('failed');
    expect(ofacOutcome.errorMessage).toContain('plausibility floor');
    expect(mocks.upsertMany).not.toHaveBeenCalledWith(
      'OFAC_SDN',
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.pruneStale).not.toHaveBeenCalledWith(
      'OFAC_SDN',
      expect.anything(),
    );
  });

  it('a near-empty parse with no prior successful sync fails against the absolute floor', async () => {
    const { service } = makeService({
      entries: { findLastSuccessfulRun: vi.fn().mockResolvedValue(null) },
      ofacRaw: () => Promise.resolve(''),
    });

    const outcomes = await service.runSync();

    const ofacOutcome = outcomes.find((o) => o.source === 'OFAC_SDN')!;
    expect(ofacOutcome.status).toBe('failed');
    expect(ofacOutcome.errorMessage).toContain('no prior successful sync');
  });

  it('a parse exactly at the ratio floor (boundary) still succeeds', async () => {
    // prior recordCount 2 -> floor = floor(2 * 0.5) = 1; the 1-record
    // fixture is `>= floor`, not `< floor`, so it must still succeed.
    const { service } = makeService({
      entries: {
        findLastSuccessfulRun: vi.fn().mockResolvedValue({ recordCount: 2 }),
      },
    });

    const outcomes = await service.runSync();

    expect(outcomes.find((o) => o.source === 'OFAC_SDN')!.status).toBe(
      'succeeded',
    );
  });

  // A @code-reviewer BLOCKER on the first pass: normalizeWatchlistName
  // reduces an all-non-Latin-script (or pure-punctuation) fullName to "" —
  // storing such a row would make "" a live, universal-wildcard lookup key.
  it('a record whose fullName normalizes to "" is filtered out before upsert, not stored', async () => {
    const { service, mocks } = makeService({
      // A single implausible-looking record would otherwise trip the
      // plausibility floor above before ever reaching the empty-name
      // filter this test targets — a prior run of 1 record lowers the
      // floor to 0 so the single parsed (then filtered-to-empty) record
      // is accepted for this test's purpose.
      entries: {
        findLastSuccessfulRun: vi.fn().mockResolvedValue({ recordCount: 1 }),
      },
      ofacRaw: () =>
        Promise.resolve(
          '1,"...---...","individual",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
        ),
    });

    const outcomes = await service.runSync();

    const ofacOutcome = outcomes.find((o) => o.source === 'OFAC_SDN')!;
    expect(ofacOutcome.status).toBe('succeeded');
    expect(ofacOutcome.recordCount).toBe(0);
    expect(mocks.upsertMany).toHaveBeenCalledWith(
      'OFAC_SDN',
      'run-OFAC_SDN',
      [],
    );
  });
});
