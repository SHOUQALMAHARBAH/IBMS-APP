import { describe, expect, it, vi } from 'vitest';
import { RfqFollowUpScheduler } from './rfq-followup.scheduler';
import type { UserRepository } from '../../repositories/user.repository';
import type { RfqService } from './rfq.service';

function makeDeps() {
  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runFollowUpScan = vi
    .fn()
    .mockResolvedValue({ candidates: 0, due: 0, alerted: 0, failed: 0 });
  const rfqs = { runFollowUpScan } as unknown as RfqService;

  return {
    scheduler: new RfqFollowUpScheduler(users, rfqs),
    mocks: { findByEmail, runFollowUpScan },
  };
}

describe('RfqFollowUpScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.runFollowUpScan).not.toHaveBeenCalled();
  });

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
});
