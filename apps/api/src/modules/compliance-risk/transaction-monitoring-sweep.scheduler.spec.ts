import { describe, expect, it, vi } from 'vitest';
import { TransactionMonitoringSweepScheduler } from './transaction-monitoring-sweep.scheduler';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { TransactionMonitoringService } from './transaction-monitoring.service';

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

  const runSweep = vi.fn().mockResolvedValue({
    scanned: 0,
    created: 0,
    skippedExisting: 0,
    failed: 0,
  });
  const monitoring = { runSweep } as unknown as TransactionMonitoringService;

  return {
    scheduler: new TransactionMonitoringSweepScheduler(
      monitoring,
      perOrganization,
    ),
    mocks: { runSweep },
  };
}

describe('TransactionMonitoringSweepScheduler.runSweep', () => {
  it('delegates to TransactionMonitoringService.runSweep with the system actor id', async () => {
    const { scheduler, mocks } = makeDeps();

    await scheduler.runSweep();

    expect(mocks.runSweep).toHaveBeenCalledWith('system-1');
  });

  it('aborts cleanly (does not throw) if the service sweep itself fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runSweep.mockRejectedValue(new Error('db down'));

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
  });
});
