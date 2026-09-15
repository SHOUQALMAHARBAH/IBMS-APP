import { describe, expect, it, vi } from 'vitest';
import { UpSellDetectionScheduler } from './up-sell-detection.scheduler';
import type { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { UpSellService } from './up-sell.service';

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
  const findCustomerIdsWithLiveProgram = vi.fn().mockResolvedValue([]);
  const insurancePrograms = {
    findCustomerIdsWithLiveProgram,
  } as unknown as InsuranceProgramRepository;
  const perOrganization = makeRunner();

  const runDetection = vi.fn().mockResolvedValue({
    flagged: null,
    suppressedByPriorResolution: false,
  });
  const upSell = { runDetection } as unknown as UpSellService;

  return {
    scheduler: new UpSellDetectionScheduler(
      insurancePrograms,
      upSell,
      perOrganization,
    ),
    mocks: { findCustomerIdsWithLiveProgram, runDetection },
  };
}

describe('UpSellDetectionScheduler.runSweep', () => {
  it('aborts cleanly if loading the customer list fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithLiveProgram.mockRejectedValue(
      new Error('db down'),
    );

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
    expect(mocks.runDetection).not.toHaveBeenCalled();
  });

  it('scans every customer even when one throws (per-customer isolation)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithLiveProgram.mockResolvedValue([
      'cust-1',
      'cust-2',
      'cust-3',
    ]);
    mocks.runDetection.mockImplementation((customerId: string) =>
      customerId === 'cust-2'
        ? Promise.reject(new Error('audit hiccup'))
        : Promise.resolve({
            flagged: null,
            suppressedByPriorResolution: false,
          }),
    );

    await scheduler.runSweep();

    expect(mocks.runDetection).toHaveBeenCalledTimes(3);
    expect(mocks.runDetection).toHaveBeenCalledWith('cust-3', 'system-1');
  });
});
