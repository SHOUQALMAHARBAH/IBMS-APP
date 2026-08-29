import { describe, expect, it, vi } from 'vitest';
import { RfqFollowUpScheduler } from './rfq-followup.scheduler';
import type { UserRepository } from '../../repositories/user.repository';
import type { RfqService } from './rfq.service';

function makeDeps() {
  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runFollowUpScan = vi.fn().mockResolvedValue({
    candidates: 0,
    due: 0,
    alerted: 0,
    autoNoResponse: 0,
    transitionSkipped: 0,
    failed: 0,
  });
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

  it('logs a summary when the sweep auto-advanced a submission', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.runFollowUpScan.mockResolvedValue({
      candidates: 3,
      due: 1,
      alerted: 0,
      autoNoResponse: 1,
      transitionSkipped: 0,
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
});
