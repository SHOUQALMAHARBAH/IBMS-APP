import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DpiaScreeningService } from './dpia-screening.service';
import type { DpiaScreeningRepository } from '../../repositories/dpia-screening.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const ALL_NO = {
  qSensitiveData: false,
  qLargeScaleProcessing: false,
  qCrossBorderTransfer: false,
  qNewTechnologyMonitoring: false,
  qNewDigitalChannel: false,
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'dpia-1',
  subjectDescription: 'New mobile claims-photo upload feature.',
  ...ALL_NO,
  outcome: 'AUTO_APPROVED',
  dpoReviewDueAt: null,
  dpoReviewedAt: null,
  dpoSpotCheckedAt: null,
  escalatedToFullDpiaAt: null,
  createdAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    recordReview: vi.fn().mockResolvedValue({ count: 1 }),
    recordSpotCheck: vi.fn().mockResolvedValue({ count: 1 }),
    escalateToFullDpia: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-14T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DpiaScreeningService(
    repo as unknown as DpiaScreeningRepository,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, slaTimer, audit };
}

describe('DpiaScreeningService.create', () => {
  it('auto-approves an all-No screening with no SLA timer started', async () => {
    const { service, repo, slaTimer } = makeService();
    const v = await service.create(
      { subjectDescription: 'x', ...ALL_NO },
      'u-dpo',
    );
    expect(v.outcome).toBe('AUTO_APPROVED');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'AUTO_APPROVED',
        dpoReviewDueAt: null,
      }),
    );
    expect(slaTimer.startTimer).not.toHaveBeenCalled();
  });

  it('requires DPO review and starts the dpia_review SLA timer on any single Yes', async () => {
    const dueAt = new Date('2026-09-14T00:00:00.000Z');
    const { service, repo, slaTimer } = makeService({
      repo: {
        create: vi.fn().mockResolvedValue(
          row({
            outcome: 'DPO_REVIEW_REQUIRED',
            dpoReviewDueAt: dueAt,
            qSensitiveData: true,
          }),
        ),
      },
    });
    const v = await service.create(
      { subjectDescription: 'x', ...ALL_NO, qSensitiveData: true },
      'u-dpo',
    );
    expect(v.outcome).toBe('DPO_REVIEW_REQUIRED');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'DPO_REVIEW_REQUIRED' }),
    );
    expect(slaTimer.computeDueAt).toHaveBeenCalledWith(
      'dpia_review',
      expect.any(Date),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'dpia_review' }),
    );
  });
});

describe('DpiaScreeningService.recordReview / escalateToFullDpia', () => {
  it('records a review and resolves the SLA timer', async () => {
    const { service, repo, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ outcome: 'DPO_REVIEW_REQUIRED' })),
      },
    });
    await service.recordReview('dpia-1', 'u-dpo');
    expect(repo.recordReview).toHaveBeenCalledWith('dpia-1', expect.any(Date));
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'dpia_review' }),
    );
  });

  it('422s a review that is not currently awaiting one', async () => {
    const { service } = makeService({
      repo: { recordReview: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.recordReview('dpia-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('escalates to Full DPIA and resolves the SLA timer', async () => {
    const { service, repo, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ outcome: 'ESCALATED_FULL_DPIA' })),
      },
    });
    await service.escalateToFullDpia('dpia-1', 'u-dpo');
    expect(repo.escalateToFullDpia).toHaveBeenCalledWith(
      'dpia-1',
      expect.any(Date),
    );
    expect(slaTimer.resolve).toHaveBeenCalled();
  });

  it('422s an escalation that is not eligible', async () => {
    const { service } = makeService({
      repo: { escalateToFullDpia: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.escalateToFullDpia('dpia-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('DpiaScreeningService.recordSpotCheck', () => {
  it('records a spot-check with no SLA involvement', async () => {
    const { service, repo, slaTimer } = makeService();
    await service.recordSpotCheck('dpia-1', 'u-dpo');
    expect(repo.recordSpotCheck).toHaveBeenCalledWith(
      'dpia-1',
      expect.any(Date),
    );
    expect(slaTimer.resolve).not.toHaveBeenCalled();
  });

  it('422s a spot-check that is not eligible (not AUTO_APPROVED, or already checked)', async () => {
    const { service } = makeService({
      repo: { recordSpotCheck: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.recordSpotCheck('dpia-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('DpiaScreeningService.get/list', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists, forwarding the outcome filter', async () => {
    const { service, repo } = makeService();
    await service.list({ outcome: 'DPO_REVIEW_REQUIRED' });
    expect(repo.findMany).toHaveBeenCalledWith(
      { outcome: 'DPO_REVIEW_REQUIRED' },
      expect.any(Number),
    );
  });
});
