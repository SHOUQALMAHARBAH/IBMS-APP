import { describe, expect, it, vi } from 'vitest';
import { KycPeriodicReviewScheduler } from './kyc-periodic-review.scheduler';
import type { KycRecordRepository } from '../../repositories/kyc-record.repository';
import type { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';

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
  const findApprovedDueForReview = vi.fn().mockResolvedValue([]);
  const kycRecords = {
    findApprovedDueForReview,
  } as unknown as KycRecordRepository;
  const perOrganization = makeRunner();

  const transition = vi.fn().mockResolvedValue({ id: 'x', status: 'x' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    scheduler: new KycPeriodicReviewScheduler(
      kycRecords,
      workflow,
      perOrganization,
    ),
    mocks: { findApprovedDueForReview, transition },
  };
}

describe('KycPeriodicReviewScheduler.runSweep', () => {
  it('processes every due record even when one throws (per-record isolation)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findApprovedDueForReview.mockResolvedValue([
      { id: 'kyc-1' },
      { id: 'kyc-2' },
      { id: 'kyc-3' },
    ]);
    mocks.transition.mockImplementation((params: { entityId: string }) =>
      params.entityId === 'kyc-2'
        ? Promise.reject(new Error('concurrent modification'))
        : Promise.resolve({
            id: params.entityId,
            status: 'PERIODIC_REVIEW_DUE',
          }),
    );

    await scheduler.runSweep();

    const ids = mocks.transition.mock.calls.map(
      ([c]: [{ entityId: string }]) => c.entityId,
    );
    expect(ids).toEqual(['kyc-1', 'kyc-2', 'kyc-3']);
  });

  it('aborts cleanly if the due-records query itself fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findApprovedDueForReview.mockRejectedValue(new Error('db down'));

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
