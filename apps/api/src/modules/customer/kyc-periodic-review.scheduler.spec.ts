import { describe, expect, it, vi } from 'vitest';
import { KycPeriodicReviewScheduler } from './kyc-periodic-review.scheduler';
import type { KycRecordRepository } from '../../repositories/kyc-record.repository';
import type { UserRepository } from '../../repositories/user.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';

function makeDeps() {
  const findApprovedDueForReview = vi.fn().mockResolvedValue([]);
  const kycRecords = {
    findApprovedDueForReview,
  } as unknown as KycRecordRepository;

  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const transition = vi.fn().mockResolvedValue({ id: 'x', status: 'x' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    scheduler: new KycPeriodicReviewScheduler(kycRecords, users, workflow),
    mocks: { findApprovedDueForReview, findByEmail, transition },
  };
}

describe('KycPeriodicReviewScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.findApprovedDueForReview).not.toHaveBeenCalled();
  });

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
