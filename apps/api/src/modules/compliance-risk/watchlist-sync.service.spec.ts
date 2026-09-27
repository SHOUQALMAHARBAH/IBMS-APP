import { describe, expect, it, vi } from 'vitest';
import type { WatchlistDatasetVersionRepository } from '../../repositories/watchlist-dataset-version.repository';
import { Prisma } from '@ibms/db';
import { WatchlistSyncService } from './watchlist-sync.service';
import type { AuditService } from '../audit/audit.service';
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
    /** Part B §6 — override the published generation a validation compares
     * against. `null` means "nothing published yet", which puts the ABSOLUTE
     * floor in force rather than the ratio one. */
    findPublished?: ReturnType<typeof vi.fn>;
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
  // Part B §21 — how many entries this run saw for the first time.
  const countAddedInRun = vi.fn().mockResolvedValue(0);
  const findLatestSyncRuns = vi.fn().mockResolvedValue([]);
  // Defaults to a prior run of 1 record (not `null`/"no prior sync") so the
  // plausibility floor (`floor(1 * WATCHLIST_MIN_ACCEPTABLE_RATIO) === 0`)
  // never blocks the 1-record OFAC_SAMPLE/UN_SAMPLE fixtures below by
  // default — tests targeting the floor itself override this explicitly.
  const findLastSuccessfulRun = vi.fn().mockResolvedValue({ recordCount: 1 });
  const countByDatasetVersion = vi.fn().mockResolvedValue(0);
  const entries = {
    createSyncRun,
    completeSyncRun,
    upsertMany,
    pruneStale,
    countAddedInRun,
    findLatestSyncRuns,
    findLastSuccessfulRun,
    ...over.entries,
    countByDatasetVersion,
  } as unknown as WatchlistEntryRepository;

  const ofac = {
    fetchRaw: over.ofacRaw ?? (() => Promise.resolve(OFAC_SAMPLE)),
  } as unknown as OfacSdnFetcher;
  const un = {
    fetchRaw: over.unRaw ?? (() => Promise.resolve(UN_SAMPLE)),
  } as unknown as UnConsolidatedFetcher;

  // Part B §6 — the generation lifecycle. Defaults describe the happy path:
  // a fresh generation, no previously published one, validation passes, the
  // flip succeeds. Individual tests override what they are about.
  const createVersion = vi.fn().mockImplementation(() =>
    Promise.resolve({
      id: 'ver-1',
      version: 'OFAC_SDN@test',
      status: 'DOWNLOADED',
    }),
  );
  // Mirrors the old `findLastSuccessfulRun` default (recordCount 1) so the
  // pre-existing cases keep testing what they were written to test: with no
  // published generation the floor would be the ABSOLUTE one (10), and the
  // 1-record sample would be rejected for reasons unrelated to those tests.
  const findPublished =
    over.findPublished ?? vi.fn().mockResolvedValue({ recordCount: 1 });
  const markValidated = vi.fn().mockResolvedValue({ id: 'ver-1' });
  const markRejected = vi.fn().mockResolvedValue({ id: 'ver-1' });
  const countNewAgainstPublished = vi.fn().mockResolvedValue(0);
  const publish = vi.fn().mockResolvedValue({ id: 'ver-1' });
  const pruneRetired = vi.fn().mockResolvedValue(0);
  const findVersionById = vi.fn().mockResolvedValue(null);
  const versions = {
    create: createVersion,
    findById: findVersionById,
    findPublished,
    markValidated,
    markRejected,
    countNewAgainstPublished,
    publish,
    pruneRetired,
  } as unknown as WatchlistDatasetVersionRepository;

  // The rollback writes an audit row — republishing an older sanctions list is
  // the module's most consequential manual override, and until 2026-09-27 its
  // only record was a `logger.warn`.
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const audit = { record: auditRecord } as unknown as AuditService;

  const service = new WatchlistSyncService(entries, versions, ofac, un, audit);
  return {
    service,
    mocks: {
      auditRecord,
      findVersionById,
      countByDatasetVersion,
      createSyncRun,
      completeSyncRun,
      upsertMany,
      createVersion,
      findPublished,
      markValidated,
      markRejected,
      publish,
      pruneRetired,
      pruneStale,
      countAddedInRun,
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
      // Part B §21 — `addedCount` reports how many entries this run saw for
      // the FIRST time, which is what the screening hold reads to decide
      // whether a pending file was checked against the current list.
      {
        source: 'OFAC_SDN',
        status: 'succeeded',
        recordCount: 1,
        addedCount: 0,
      },
      {
        source: 'UN_CONSOLIDATED',
        status: 'succeeded',
        recordCount: 1,
        addedCount: 0,
      },
    ]);
    expect(mocks.createSyncRun).toHaveBeenCalledWith('OFAC_SDN');
    expect(mocks.createSyncRun).toHaveBeenCalledWith('UN_CONSOLIDATED');
    // Part B §6 — rows are written against a GENERATION, and that generation
    // is published only after validation. The order is the guarantee: nothing
    // a screening can read changes until `publish`.
    expect(mocks.upsertMany).toHaveBeenCalledWith(
      'OFAC_SDN',
      'run-OFAC_SDN',
      expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: '2674' }),
      ]),
      'ver-1',
    );
    expect(mocks.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'OFAC_SDN' }),
    );
    expect(mocks.markValidated).toHaveBeenCalledWith('ver-1', 1);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ver-1' }),
    );
    expect(mocks.pruneRetired).toHaveBeenCalledWith('OFAC_SDN');
    expect(mocks.completeSyncRun).toHaveBeenCalledWith('run-OFAC_SDN', {
      recordCount: 1,
      addedCount: 0,
    });
  });

  it('stamps normalizedName on every upserted record', async () => {
    const { service, mocks } = makeService();

    await service.runSync();

    const [, , records] = mocks.upsertMany.mock.calls[0] as [
      string,
      string,
      { normalizedName: string }[],
      string,
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
      findPublished: vi.fn().mockResolvedValue({ recordCount: 1000 }),
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
    // The published generation is untouched: nothing was published, so every
    // screening still reads the list that was in force before this attempt.
    expect(mocks.publish).not.toHaveBeenCalled();
    // And the refusal is RECORDED against the generation, not just thrown.
    expect(mocks.markRejected).toHaveBeenCalledWith(
      'ver-1',
      expect.stringContaining('plausibility floor'),
    );
  });

  it('a near-empty parse with no prior successful sync fails against the absolute floor', async () => {
    const { service } = makeService({
      findPublished: vi.fn().mockResolvedValue(null),
      ofacRaw: () => Promise.resolve(''),
    });

    const outcomes = await service.runSync();

    const ofacOutcome = outcomes.find((o) => o.source === 'OFAC_SDN')!;
    expect(ofacOutcome.status).toBe('failed');
    expect(ofacOutcome.errorMessage).toContain(
      'no previously published generation',
    );
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
      'ver-1',
    );
  });
});

/*
 * REPUBLISHING AN OLDER SANCTIONS LIST — the module's own comment calls it "the
 * most consequential manual override in this module", and until 2026-09-27 it had
 * no web caller and wrote no audit row (IMPROVEMENTS § 1.44, § 1.63).
 *
 * WHAT WAS AND WAS NOT ALREADY TESTED — corrected after checking rather than
 * asserted: `watchlist-dataset-lifecycle.e2e-spec.ts` already covers the happy
 * path, the mandatory reason and the RBAC refusal. What it does NOT cover is the
 * two STATE refusals, which is what the tests below add.
 *
 * Those refusals are three different operator problems and are asserted
 * separately, because a single "it refuses" test cannot tell them apart — and the
 * retention one is the case an operator actually hits.
 */
describe('rollbackDataset', () => {
  const SUPERSEDED = {
    id: 'ver-old',
    source: 'OFAC_SDN',
    status: 'SUPERSEDED',
    version: '2026-08-01',
  };

  it('refuses a generation that does not exist', async () => {
    const { service, mocks } = makeService();
    mocks.findVersionById.mockResolvedValue(null);
    await expect(
      service.rollbackDataset('nope', 'A stated reason, long enough', 'user-1'),
    ).rejects.toThrow(/not found/i);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('refuses a generation that is not SUPERSEDED, naming its status', async () => {
    // Republishing the already-live one is a no-op dressed as an action, and a
    // REJECTED one was refused for a reason.
    const { service, mocks } = makeService();
    mocks.findVersionById.mockResolvedValue({
      ...SUPERSEDED,
      status: 'PUBLISHED',
    });
    await expect(
      service.rollbackDataset(
        'ver-old',
        'A stated reason, long enough',
        'user-1',
      ),
    ).rejects.toThrow(/PUBLISHED/);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('refuses a generation whose rows retention has already reclaimed', async () => {
    // THE ONE AN OPERATOR ACTUALLY HITS. The generation is still listed, so it
    // looks available; its entries are gone, so restoring it would leave
    // screening running against nothing. A silent success here would be the worst
    // outcome available — screening that finds nobody looks exactly like
    // screening that cleared everybody.
    const { service, mocks } = makeService();
    mocks.findVersionById.mockResolvedValue(SUPERSEDED);
    mocks.countByDatasetVersion.mockResolvedValue(0);
    await expect(
      service.rollbackDataset(
        'ver-old',
        'A stated reason, long enough',
        'user-1',
      ),
    ).rejects.toThrow(/no records left/i);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('republishes the generation and AUDITS the act with its stated reason', async () => {
    const { service, mocks } = makeService();
    mocks.findVersionById.mockResolvedValue(SUPERSEDED);
    mocks.countByDatasetVersion.mockResolvedValue(4231);
    mocks.findPublished.mockResolvedValue({
      id: 'ver-current',
      version: '2026-09-01',
    });
    mocks.publish.mockResolvedValue({ ...SUPERSEDED, status: 'PUBLISHED' });

    const REASON = 'The 2026-09-01 ingest truncated the SDN list at 400 rows';
    await service.rollbackDataset('ver-old', REASON, 'user-1');

    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ver-old',
        publishedByUserId: 'user-1',
        rolledBackFromId: 'ver-current',
        rollbackReason: REASON,
      }),
    );

    // The audit row is the point: an application log is not the audit trail —
    // not queryable from the audit screen, not covered by the immutability
    // trigger, not retained on the same terms. "Who decided we screen against
    // last month's list, and why" is what an examiner asks.
    expect(mocks.auditRecord).toHaveBeenCalledTimes(1);
    const row = mocks.auditRecord.mock.calls[0][0] as {
      userId: string;
      action: string;
      entityType: string;
      beforeValue: { publishedVersion: string | null };
      afterValue: { rollbackReason: string; publishedVersion: string };
    };
    expect(row.userId).toBe('user-1');
    expect(row.entityType).toBe('WatchlistDatasetVersion');
    // BOTH SIDES: which list we were on, and which we moved to. A row carrying
    // only the new version cannot answer what was given up.
    expect(row.beforeValue.publishedVersion).toBe('2026-09-01');
    expect(row.afterValue.publishedVersion).toBe('2026-08-01');
    expect(row.afterValue.rollbackReason).toBe(REASON);
  });

  it('does not fail the rollback when the audit write fails', async () => {
    // The rollback has committed and screening has already moved, so reporting a
    // failure now would describe something that did happen as not having happened.
    const { service, mocks } = makeService();
    mocks.findVersionById.mockResolvedValue(SUPERSEDED);
    mocks.countByDatasetVersion.mockResolvedValue(10);
    mocks.publish.mockResolvedValue({ ...SUPERSEDED, status: 'PUBLISHED' });
    mocks.auditRecord.mockRejectedValue(new Error('audit down'));

    await expect(
      service.rollbackDataset(
        'ver-old',
        'A stated reason, long enough',
        'user-1',
      ),
    ).resolves.toMatchObject({ id: 'ver-old' });
  });
});
