import { describe, expect, it, vi } from 'vitest';
import { RetentionSweepScheduler } from './retention-sweep.scheduler';
import type { UserRepository } from '../../repositories/user.repository';
import type { RetentionCaseService } from './retention-case.service';

function makeDeps() {
  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runSweep = vi.fn().mockResolvedValue({
    scanned: 0,
    openedRenewalInactivity: 0,
    openedLapseRisk: 0,
    failed: 0,
  });
  const retentionCases = { runSweep } as unknown as RetentionCaseService;

  return {
    scheduler: new RetentionSweepScheduler(users, retentionCases),
    mocks: { findByEmail, runSweep },
  };
}

describe('RetentionSweepScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.runSweep).not.toHaveBeenCalled();
  });

  it('delegates to RetentionCaseService.runSweep with the system actor id', async () => {
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
