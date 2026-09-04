import { describe, expect, it, vi } from 'vitest';
import { WatchlistSyncScheduler } from './watchlist-sync.scheduler';
import type { WatchlistSyncService } from './watchlist-sync.service';

function makeDeps() {
  const runSync = vi.fn().mockResolvedValue([
    { source: 'OFAC_SDN', status: 'succeeded', recordCount: 1 },
    { source: 'UN_CONSOLIDATED', status: 'succeeded', recordCount: 1 },
  ]);
  const sync = { runSync } as unknown as WatchlistSyncService;
  return { scheduler: new WatchlistSyncScheduler(sync), mocks: { runSync } };
}

describe('WatchlistSyncScheduler.runSync', () => {
  it('delegates to WatchlistSyncService.runSync', async () => {
    const { scheduler, mocks } = makeDeps();
    await scheduler.runSync();
    expect(mocks.runSync).toHaveBeenCalled();
  });

  it('a per-source failure in the outcome list does not throw', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runSync.mockResolvedValue([
      { source: 'OFAC_SDN', status: 'failed', errorMessage: 'unreachable' },
      { source: 'UN_CONSOLIDATED', status: 'succeeded', recordCount: 1 },
    ]);
    await expect(scheduler.runSync()).resolves.toBeUndefined();
  });

  it('aborts cleanly (does not throw) if the service itself rejects', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runSync.mockRejectedValue(new Error('db down'));
    await expect(scheduler.runSync()).resolves.toBeUndefined();
  });
});
