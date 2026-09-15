import { describe, expect, it, vi } from 'vitest';
import { ClaimFollowUpScheduler } from './claim-followup.scheduler';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { ClaimService } from './claim.service';

const EMPTY_RESULT = {
  awaiting: 0,
  due: 0,
  raised: 0,
  skippedAlreadyAlerted: 0,
  autoResolved: 0,
  failed: 0,
};

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

  const runFollowUpScan = vi.fn().mockResolvedValue({ ...EMPTY_RESULT });
  const claims = { runFollowUpScan } as unknown as ClaimService;

  return {
    scheduler: new ClaimFollowUpScheduler(claims, perOrganization),
    mocks: { runFollowUpScan },
  };
}

describe('ClaimFollowUpScheduler.runSweep', () => {
  it('delegates to ClaimService.runFollowUpScan with the system account id', async () => {
    const { scheduler, mocks } = makeDeps();

    await scheduler.runSweep();

    expect(mocks.runFollowUpScan).toHaveBeenCalledWith('system-1');
  });

  it('resolves cleanly when the scan throws', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runFollowUpScan.mockRejectedValue(new Error('db down'));

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
  });

  it('logs a summary when the sweep raised or auto-resolved something', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runFollowUpScan.mockResolvedValue({
      ...EMPTY_RESULT,
      awaiting: 4,
      due: 2,
      raised: 1,
      autoResolved: 1,
    });
    const logSpy = vi
      .spyOn(
        (scheduler as unknown as { logger: { log: (m: string) => void } })
          .logger,
        'log',
      )
      .mockImplementation(() => undefined);

    await scheduler.runSweep();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('newly alerted'),
    );
  });

  it('stays quiet when the sweep did nothing', async () => {
    const { scheduler } = makeDeps();
    const logSpy = vi
      .spyOn(
        (scheduler as unknown as { logger: { log: (m: string) => void } })
          .logger,
        'log',
      )
      .mockImplementation(() => undefined);

    await scheduler.runSweep();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
