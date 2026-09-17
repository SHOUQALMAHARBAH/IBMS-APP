import { describe, expect, it, vi } from 'vitest';
import { CrossSellDetectionScheduler } from './cross-sell-detection.scheduler';
import type { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { CrossSellService } from './cross-sell.service';

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
  const findCustomerIdsWithInForcePolicy = vi.fn().mockResolvedValue([]);
  const opportunities = {
    findCustomerIdsWithInForcePolicy,
  } as unknown as CrossSellOpportunityRepository;
  const perOrganization = makeRunner();

  const runDetection = vi
    .fn()
    .mockResolvedValue({ heldLines: [], gapLines: [], newlyFlagged: [] });
  const crossSell = { runDetection } as unknown as CrossSellService;

  return {
    scheduler: new CrossSellDetectionScheduler(
      opportunities,
      crossSell,
      perOrganization,
    ),
    mocks: { findCustomerIdsWithInForcePolicy, runDetection },
  };
}

describe('CrossSellDetectionScheduler.runSweep', () => {
  it('aborts cleanly if loading the customer list fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithInForcePolicy.mockRejectedValue(
      new Error('db down'),
    );

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
    expect(mocks.runDetection).not.toHaveBeenCalled();
  });

  it('scans every customer even when one throws (per-customer isolation)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithInForcePolicy.mockResolvedValue([
      'cust-1',
      'cust-2',
      'cust-3',
    ]);
    mocks.runDetection.mockImplementation((customerId: string) =>
      customerId === 'cust-2'
        ? Promise.reject(new Error('audit hiccup'))
        : Promise.resolve({
            heldLines: [],
            gapLines: [],
            newlyFlagged: [],
          }),
    );

    await scheduler.runSweep();

    expect(mocks.runDetection).toHaveBeenCalledTimes(3);
    expect(mocks.runDetection).toHaveBeenCalledWith('cust-3', 'system-1');
  });
});
