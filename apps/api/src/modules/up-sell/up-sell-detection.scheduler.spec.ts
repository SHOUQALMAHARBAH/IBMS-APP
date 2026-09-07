import { describe, expect, it, vi } from 'vitest';
import { UpSellDetectionScheduler } from './up-sell-detection.scheduler';
import type { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import type { UserRepository } from '../../repositories/user.repository';
import type { UpSellService } from './up-sell.service';

function makeDeps() {
  const findCustomerIdsWithLiveProgram = vi.fn().mockResolvedValue([]);
  const insurancePrograms = {
    findCustomerIdsWithLiveProgram,
  } as unknown as InsuranceProgramRepository;

  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runDetection = vi.fn().mockResolvedValue({
    flagged: null,
    suppressedByPriorResolution: false,
  });
  const upSell = { runDetection } as unknown as UpSellService;

  return {
    scheduler: new UpSellDetectionScheduler(insurancePrograms, users, upSell),
    mocks: { findCustomerIdsWithLiveProgram, findByEmail, runDetection },
  };
}

describe('UpSellDetectionScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.findCustomerIdsWithLiveProgram).not.toHaveBeenCalled();
  });

  it('aborts cleanly if loading the customer list fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithLiveProgram.mockRejectedValue(
      new Error('db down'),
    );

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
    expect(mocks.runDetection).not.toHaveBeenCalled();
  });

  it('scans every customer even when one throws (per-customer isolation)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithLiveProgram.mockResolvedValue([
      'cust-1',
      'cust-2',
      'cust-3',
    ]);
    mocks.runDetection.mockImplementation((customerId: string) =>
      customerId === 'cust-2'
        ? Promise.reject(new Error('audit hiccup'))
        : Promise.resolve({
            flagged: null,
            suppressedByPriorResolution: false,
          }),
    );

    await scheduler.runSweep();

    expect(mocks.runDetection).toHaveBeenCalledTimes(3);
    expect(mocks.runDetection).toHaveBeenCalledWith('cust-3', 'system-1');
  });
});
