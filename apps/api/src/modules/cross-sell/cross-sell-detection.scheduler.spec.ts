import { describe, expect, it, vi } from 'vitest';
import { CrossSellDetectionScheduler } from './cross-sell-detection.scheduler';
import type { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
import type { UserRepository } from '../../repositories/user.repository';
import type { CrossSellService } from './cross-sell.service';

function makeDeps() {
  const findCustomerIdsWithInForcePolicy = vi.fn().mockResolvedValue([]);
  const opportunities = {
    findCustomerIdsWithInForcePolicy,
  } as unknown as CrossSellOpportunityRepository;

  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const runDetection = vi
    .fn()
    .mockResolvedValue({ heldLines: [], gapLines: [], newlyFlagged: [] });
  const crossSell = { runDetection } as unknown as CrossSellService;

  return {
    scheduler: new CrossSellDetectionScheduler(opportunities, users, crossSell),
    mocks: { findCustomerIdsWithInForcePolicy, findByEmail, runDetection },
  };
}

describe('CrossSellDetectionScheduler.runSweep', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runSweep();

    expect(mocks.findCustomerIdsWithInForcePolicy).not.toHaveBeenCalled();
  });

  it('aborts cleanly if loading the customer list fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithInForcePolicy.mockRejectedValue(
      new Error('db down'),
    );

    await expect(scheduler.runSweep()).resolves.toBeUndefined();
    expect(mocks.runDetection).not.toHaveBeenCalled();
  });

  it('scans every customer even when one throws (per-customer isolation)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findCustomerIdsWithInForcePolicy.mockResolvedValue([
      'cust-1',
      'cust-2',
      'cust-3',
    ]);
    mocks.runDetection.mockImplementation((customerId: string) =>
      customerId === 'cust-2'
        ? Promise.reject(new Error('audit hiccup'))
        : Promise.resolve({
            heldLines: [],
            gapLines: [],
            newlyFlagged: [],
          }),
    );

    await scheduler.runSweep();

    expect(mocks.runDetection).toHaveBeenCalledTimes(3);
    expect(mocks.runDetection).toHaveBeenCalledWith('cust-3', 'system-1');
  });
});
