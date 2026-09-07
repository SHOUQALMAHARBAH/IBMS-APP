import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LegalHoldService } from './legal-hold.service';
import type { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'lh-1',
  scope: 'Customer XYZ file',
  reason: 'Litigation pending.',
  placedAt: new Date('2026-09-14T00:00:00.000Z'),
  nextReviewDueAt: new Date('2027-03-14T00:00:00.000Z'),
  releasedAt: null,
  retentionScheduleItemId: 'rsi-1',
  customerId: null,
  insuredPersonId: null,
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    retentionScheduleItemExists: vi.fn().mockResolvedValue(true),
    customerExists: vi.fn().mockResolvedValue(true),
    insuredPersonExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    hasActiveHold: vi.fn().mockResolvedValue(false),
    hasActiveHoldForSubject: vi.fn().mockResolvedValue(false),
    recordReview: vi.fn().mockResolvedValue({ count: 1 }),
    release: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2027-03-14T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new LegalHoldService(
    repo as unknown as LegalHoldRepository,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, slaTimer, audit };
}

describe('LegalHoldService.create', () => {
  it('places a hold, computing nextReviewDueAt from the 6-month SLA entry and starting its timer', async () => {
    const { service, repo, slaTimer, audit } = makeService();
    const v = await service.create(
      {
        scope: 'Customer XYZ file',
        reason: 'Litigation pending.',
        retentionScheduleItemId: 'rsi-1',
      },
      'u-dpo',
    );
    expect(v.isActive).toBe(true);
    expect(slaTimer.computeDueAt).toHaveBeenCalledWith(
      'legal_hold_necessity_review',
      expect.any(Date),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'LegalHold',
        workflowName: 'legal_hold_necessity_review',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'LegalHold' }),
    );
    expect(repo.create).toHaveBeenCalled();
  });

  it('404s an unknown retentionScheduleItemId', async () => {
    const { service } = makeService({
      repo: { retentionScheduleItemExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create(
        { scope: 's', reason: 'r', retentionScheduleItemId: 'nope' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a hold with no retentionScheduleItemId at all', async () => {
    const { service, repo } = makeService();
    await service.create({ scope: 's', reason: 'r' }, 'u-dpo');
    expect(repo.retentionScheduleItemExists).not.toHaveBeenCalled();
  });

  it('places a hold naming a customer, existence-checked, passed through to the repository', async () => {
    const { service, repo } = makeService();
    await service.create(
      { scope: 's', reason: 'r', customerId: 'cust-1' },
      'u-dpo',
    );
    expect(repo.customerExists).toHaveBeenCalledWith('cust-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', insuredPersonId: null }),
    );
  });

  it('404s an unknown customerId', async () => {
    const { service } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create(
        { scope: 's', reason: 'r', customerId: 'nope' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an unknown insuredPersonId', async () => {
    const { service } = makeService({
      repo: { insuredPersonExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create(
        { scope: 's', reason: 'r', insuredPersonId: 'nope' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s when both customerId and insuredPersonId are set — ambiguous which one names the subject', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(
        {
          scope: 's',
          reason: 'r',
          customerId: 'cust-1',
          insuredPersonId: 'ip-1',
        },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('LegalHoldService.recordReview', () => {
  it('re-bases nextReviewDueAt, start-then-resolve', async () => {
    const { service, repo, slaTimer } = makeService();
    await service.recordReview('lh-1', 'u-dpo');
    expect(repo.recordReview).toHaveBeenCalledWith('lh-1', expect.any(Date));
    expect(slaTimer.startTimer).toHaveBeenCalled();
    expect(slaTimer.resolve).toHaveBeenCalled();
    const resolveCall = slaTimer.resolve.mock.calls[0]?.[0] as {
      createdBefore?: Date;
    };
    expect(resolveCall.createdBefore).toBeInstanceOf(Date);
  });

  it('422s a review on an already-released hold', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ releasedAt: new Date('2026-10-01T00:00:00.000Z') }),
          ),
      },
    });
    await expect(service.recordReview('lh-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('409s a genuine concurrent race', async () => {
    const { service } = makeService({
      repo: {
        recordReview: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi.fn().mockResolvedValue(row()),
      },
    });
    await expect(service.recordReview('lh-1', 'u-dpo')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('LegalHoldService.release', () => {
  it('releases an active hold and resolves its SLA timer permanently', async () => {
    const { service, repo, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row())
          .mockResolvedValueOnce(
            row({ releasedAt: new Date('2026-10-01T00:00:00.000Z') }),
          ),
      },
    });
    const v = await service.release('lh-1', 'u-dpo');
    expect(v.isActive).toBe(false);
    expect(repo.release).toHaveBeenCalledWith('lh-1', expect.any(Date));
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'LegalHold', entityId: 'lh-1' }),
    );
  });

  it('is idempotent on an already-released hold', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ releasedAt: new Date('2026-10-01T00:00:00.000Z') }),
          ),
      },
    });
    const v = await service.release('lh-1', 'u-dpo');
    expect(v.isActive).toBe(false);
    expect(repo.release).not.toHaveBeenCalled();
  });
});

describe('LegalHoldService reads', () => {
  it('lists holds with filters passed through', async () => {
    const { service, repo } = makeService();
    await service.list({ retentionScheduleItemId: 'rsi-1', active: true });
    expect(repo.findMany).toHaveBeenCalledWith({
      retentionScheduleItemId: 'rsi-1',
      active: true,
    });
  });

  it('lists holds scoped to one data subject — the same query fulfil() runs internally', async () => {
    const { service, repo } = makeService();
    await service.list({ customerId: 'cust-1' });
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1' }),
    );
  });

  it('404s an unknown hold on get', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
