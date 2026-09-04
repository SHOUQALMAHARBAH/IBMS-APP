import { describe, expect, it, vi } from 'vitest';
import { ScreeningBatchScheduler } from './screening-batch.scheduler';
import type { UserRepository } from '../../repositories/user.repository';
import type { ScreeningService } from './screening.service';

function makeDeps() {
  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runRecurringBatch = vi
    .fn()
    .mockResolvedValue({ screened: 0, hits: 0, failed: 0 });
  const screening = { runRecurringBatch } as unknown as ScreeningService;

  return {
    scheduler: new ScreeningBatchScheduler(users, screening),
    mocks: { findByEmail, runRecurringBatch },
  };
}

describe('ScreeningBatchScheduler.runBatch', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runBatch();

    expect(mocks.runRecurringBatch).not.toHaveBeenCalled();
  });

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
