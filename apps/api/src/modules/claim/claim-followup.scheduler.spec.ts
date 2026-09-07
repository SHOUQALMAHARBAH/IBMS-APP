import { describe, expect, it, vi } from 'vitest';
import { ClaimFollowUpScheduler } from './claim-followup.scheduler';
import type { UserRepository } from '../../repositories/user.repository';
import type { ClaimService } from './claim.service';

const EMPTY_RESULT = {
  awaiting: 0,
  due: 0,
  raised: 0,
  skippedAlreadyAlerted: 0,
  autoResolved: 0,
  failed: 0,
};

function makeDeps() {
  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runFollowUpScan = vi.fn().mockResolvedValue({ ...EMPTY_RESULT });
  const claims = { runFollowUpScan } as unknown as ClaimService;

  return {
    scheduler: new ClaimFollowUpScheduler(users, claims),
    mocks: { findByEmail, runFollowUpScan },
  };
}

describe('ClaimFollowUpScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.runFollowUpScan).not.toHaveBeenCalled();
  });

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
