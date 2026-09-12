import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchedulerRegistry } from '@nestjs/schedule';
import { ScheduledJobsGuard } from './scheduled-jobs.guard';

function registryWith(names: string[]) {
  const stops = new Map<string, ReturnType<typeof vi.fn>>();
  const jobs = new Map<string, { stop: () => void }>();
  for (const name of names) {
    const stop = vi.fn();
    stops.set(name, stop);
    jobs.set(name, { stop });
  }
  const deleted: string[] = [];
  const registry = {
    getCronJobs: () => jobs,
    deleteCronJob: (name: string) => {
      deleted.push(name);
      jobs.delete(name);
    },
  } as unknown as SchedulerRegistry;
  return { registry, deleted, stops };
}

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.SCHEDULED_JOBS;
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe('ScheduledJobsGuard', () => {
  it('removes every cron job when SCHEDULED_JOBS=disabled', async () => {
    process.env.SCHEDULED_JOBS = 'disabled';
    const { registry, deleted, stops } = registryWith([
      'watchlist-sync',
      'sla-timer-escalation',
      'kyc-periodic-review',
    ]);

    await new ScheduledJobsGuard(registry).onApplicationBootstrap();

    expect(deleted.sort()).toEqual([
      'kyc-periodic-review',
      'sla-timer-escalation',
      'watchlist-sync',
    ]);
    for (const stop of stops.values()) expect(stop).toHaveBeenCalled();
  });

  it('leaves jobs running when the variable is unset', async () => {
    // Defaults to ON: a deployment that silently stopped re-screening customers
    // against sanctions lists would be a compliance failure, not a nuisance.
    const { registry, deleted } = registryWith(['watchlist-sync']);

    await new ScheduledJobsGuard(registry).onApplicationBootstrap();

    expect(deleted).toEqual([]);
  });

  it('leaves jobs running for any value other than the exact word', async () => {
    for (const value of ['false', 'off', '0', 'DISABLED', 'disable', '']) {
      process.env.SCHEDULED_JOBS = value;
      const { registry, deleted } = registryWith(['watchlist-sync']);
      await new ScheduledJobsGuard(registry).onApplicationBootstrap();
      expect(deleted, `value ${JSON.stringify(value)}`).toEqual([]);
    }
  });

  it('covers jobs added later, because it reads the registry rather than a list', async () => {
    // The reason this deletes from the registry instead of guarding 19
    // handlers: the twentieth would be added without a guard.
    process.env.SCHEDULED_JOBS = 'disabled';
    const { registry, deleted } = registryWith([
      'a-job-that-did-not-exist-when-this-was-written',
    ]);

    await new ScheduledJobsGuard(registry).onApplicationBootstrap();

    expect(deleted).toEqual(['a-job-that-did-not-exist-when-this-was-written']);
  });

  it('does nothing, without error, when there are no jobs', async () => {
    process.env.SCHEDULED_JOBS = 'disabled';
    const { registry, deleted } = registryWith([]);

    await expect(
      new ScheduledJobsGuard(registry).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(deleted).toEqual([]);
  });
});
