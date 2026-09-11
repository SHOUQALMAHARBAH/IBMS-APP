import { describe, expect, it, vi } from 'vitest';
import { RfqFollowUpScheduler } from './rfq-followup.scheduler';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { RfqService } from './rfq.service';

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

  const runFollowUpScan = vi.fn().mockResolvedValue({
    candidates: 0,
    due: 0,
    alerted: 0,
    autoNoResponse: 0,
    transitionSkipped: 0,
    skippedQuoted: 0,
    failed: 0,
  });
  const rfqs = { runFollowUpScan } as unknown as RfqService;

  return {
    scheduler: new RfqFollowUpScheduler(rfqs, perOrganization),
    mocks: { runFollowUpScan },
  };
}

describe('RfqFollowUpScheduler.runSweep', () => {
  it('delegates to RfqService.runFollowUpScan with the system account id', async () => {
    const { scheduler, mocks } = makeDeps();

    await scheduler.runSweep();

    expect(mocks.runFollowUpScan).toHaveBeenCalledWith('system-1');
  });

  it('resolves cleanly when the scan throws', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runFollowUpScan.mockRejectedValue(new Error('db down'));

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
  });

  it('logs a summary when the sweep auto-advanced a submission', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runFollowUpScan.mockResolvedValue({
      candidates: 3,
      due: 1,
      alerted: 0,
      autoNoResponse: 1,
      transitionSkipped: 0,
      skippedQuoted: 0,
      failed: 0,
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
      expect.stringContaining('moved to NO_RESPONSE'),
    );
  });

  it('logs a summary when the sweep only skipped already-quoted submissions', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runFollowUpScan.mockResolvedValue({
      candidates: 2,
      due: 0,
      alerted: 0,
      autoNoResponse: 0,
      transitionSkipped: 0,
      skippedQuoted: 2,
      failed: 0,
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
      expect.stringContaining('skipped (already quoted)'),
    );
  });
});
