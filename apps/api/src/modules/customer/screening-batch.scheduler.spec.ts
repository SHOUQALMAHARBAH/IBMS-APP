import { describe, expect, it, vi } from 'vitest';
import { ScreeningBatchScheduler } from './screening-batch.scheduler';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { KycRecordRepository } from '../../repositories/kyc-record.repository';
import type { UserRepository } from '../../repositories/user.repository';
import type { ScreeningService } from './screening.service';

function makeDeps() {
  const findActive = vi.fn().mockResolvedValue([]);
  const customers = { findActive } as unknown as CustomerRepository;

  const findLatestByCustomerId = vi
    .fn()
    .mockResolvedValue({ id: 'kyc-x', status: 'APPROVED' });
  const kycRecords = {
    findLatestByCustomerId,
  } as unknown as KycRecordRepository;

  const findByEmail = vi
    .fn()
    .mockResolvedValue({ id: 'system-1', email: 'system@ibms.internal' });
  const users = { findByEmail } as unknown as UserRepository;

  const run = vi.fn().mockResolvedValue({
    results: [],
    riskLevel: 'STANDARD',
    isEdd: false,
    newHit: false,
  });
  const screening = { run } as unknown as ScreeningService;

  return {
    scheduler: new ScreeningBatchScheduler(
      customers,
      kycRecords,
      users,
      screening,
    ),
    mocks: { findActive, findLatestByCustomerId, findByEmail, run },
  };
}

describe('ScreeningBatchScheduler.runBatch', () => {
  it('does nothing when the system service account is missing', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findByEmail.mockResolvedValue(null);

    await scheduler.runBatch();

    expect(mocks.findActive).not.toHaveBeenCalled();
  });

  it('re-screens every eligible customer even when one throws (per-customer isolation)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findActive.mockResolvedValue([
      { id: 'cust-1' },
      { id: 'cust-2' },
      { id: 'cust-3' },
    ]);
    // The 2nd customer resolves to a KYC id whose screening throws.
    mocks.findLatestByCustomerId
      .mockResolvedValueOnce({ id: 'kyc-1', status: 'APPROVED' })
      .mockResolvedValueOnce({ id: 'kyc-boom', status: 'APPROVED' })
      .mockResolvedValueOnce({ id: 'kyc-3', status: 'APPROVED' });
    mocks.run.mockImplementation((kycId: string) =>
      kycId === 'kyc-boom'
        ? Promise.reject(new Error('provider timeout'))
        : Promise.resolve({
            results: [],
            riskLevel: 'STANDARD',
            isEdd: false,
            newHit: false,
          }),
    );

    await scheduler.runBatch();

    expect(mocks.run).toHaveBeenCalledTimes(3);
  });

  it('skips a customer whose latest KYC file is still mid-onboarding (SCREENING)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findActive.mockResolvedValue([{ id: 'cust-1' }]);
    mocks.findLatestByCustomerId.mockResolvedValue({
      id: 'kyc-x',
      status: 'SCREENING',
    });

    await scheduler.runBatch();

    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('re-screens a customer whose latest KYC file is PERIODIC_REVIEW_DUE (re-KYC pending, still ACTIVE)', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findActive.mockResolvedValue([{ id: 'cust-1' }]);
    mocks.findLatestByCustomerId.mockResolvedValue({
      id: 'kyc-due',
      status: 'PERIODIC_REVIEW_DUE',
    });

    await scheduler.runBatch();

    expect(mocks.run).toHaveBeenCalledWith('kyc-due', 'system-1');
  });

  it('aborts cleanly if loading active customers fails', async () => {
    const { scheduler, mocks } = makeDeps();
    mocks.findActive.mockRejectedValue(new Error('db down'));

    await expect(scheduler.runBatch()).resolves.toBeUndefined();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
