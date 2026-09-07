import { describe, expect, it, vi } from 'vitest';
import { TransactionMonitoringSweepScheduler } from './transaction-monitoring-sweep.scheduler';
import type { UserRepository } from '../../repositories/user.repository';
import type { TransactionMonitoringService } from './transaction-monitoring.service';

function makeDeps() {
  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runSweep = vi.fn().mockResolvedValue({
    scanned: 0,
    created: 0,
    skippedExisting: 0,
    failed: 0,
  });
  const monitoring = { runSweep } as unknown as TransactionMonitoringService;

  return {
    scheduler: new TransactionMonitoringSweepScheduler(users, monitoring),
    mocks: { findByEmail, runSweep },
  };
}

describe('TransactionMonitoringSweepScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.runSweep).not.toHaveBeenCalled();
  });

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
