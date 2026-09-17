import { describe, expect, it, vi } from 'vitest';
import { ScreeningBatchScheduler } from './screening-batch.scheduler';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { ScreeningService } from './screening.service';

/**
 * Multi-tenancy Phase 2 (step 7) — the scheduler no longer resolves the system
 * service account itself; `PerOrganizationRunner` does, once per ACTIVE
 * Organization. This stand-in plays the single-Organization case: it invokes
 * the callback once with that org's service-account id.
 *
 * The behaviours that moved out of the scheduler — looping every ACTIVE
 * Organization, skipping one with no service account, isolating one org's
 * failure from the rest — are covered by per-organization.runner.spec.ts,
 * where they now live.
 */
function makeRunner() {
  const forEach = vi.fn(
    async (
      _job: string,
      _logger: unknown,
      work: (systemUserId: string, organizationId: string) => Promise<void>,
    ) => {
      await work('system-1', 'org-1');
    },
  );
  return { forEach } as unknown as PerOrganizationRunner;
}

function makeDeps() {
  const perOrganization = makeRunner();

  const runRecurringBatch = vi
    .fn()
    .mockResolvedValue({ screened: 0, hits: 0, failed: 0 });
  const screening = { runRecurringBatch } as unknown as ScreeningService;

  return {
    scheduler: new ScreeningBatchScheduler(screening, perOrganization),
    mocks: { runRecurringBatch },
  };
}

describe('ScreeningBatchScheduler.runBatch', () => {
  it('delegates to ScreeningService.runRecurringBatch with the system actor id', async () => {
    const { scheduler, mocks } = makeDeps();

    await scheduler.runBatch();

    expect(mocks.runRecurringBatch).toHaveBeenCalledWith('system-1');
  });

  it('aborts cleanly (does not throw) if the service batch itself fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runRecurringBatch.mockRejectedValue(new Error('db down'));

    await expect(scheduler.runBatch()).resolves.toBeUndefined();
  });
});
