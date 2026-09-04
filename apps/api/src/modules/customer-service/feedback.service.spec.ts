import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import type { FeedbackRepository } from '../../repositories/feedback.repository';
import type { AuditService } from '../audit/audit.service';

const feedbackRow = (over: Record<string, unknown> = {}) => ({
  id: 'fb-1',
  customerId: 'cust-1',
  context: 'post_claim',
  score: 4,
  comments: 'Great service overall.',
  submittedAt: new Date('2026-09-04T09:00:00.000Z'),
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(feedbackRow()),
    findById: vi.fn().mockResolvedValue(feedbackRow()),
    findMany: vi.fn().mockResolvedValue([]),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new FeedbackService(
    repo as unknown as FeedbackRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('FeedbackService.create (Process 45)', () => {
  it('404s when the customer does not exist', async () => {
    const { service } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create({ customerId: 'nope', context: 'post_claim' }, 'u-sales'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates the row and writes a CREATE audit row that excludes comments', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      {
        customerId: 'cust-1',
        context: 'post_claim',
        score: 4,
        comments: 'Great service overall.',
      },
      'u-sales',
    );
    expect(v.id).toBe('fb-1');
    expect(v.comments).toBe('Great service overall.');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        context: 'post_claim',
        score: 4,
        comments: 'Great service overall.',
      }),
    );
    const auditCall = audit.record.mock.calls[0][0] as {
      action: string;
      entityType: string;
      entityId: string;
      afterValue: Record<string, unknown>;
    };
    expect(auditCall).toMatchObject({
      action: 'CREATE',
      entityType: 'CustomerFeedback',
      entityId: 'fb-1',
    });
    expect(Object.keys(auditCall.afterValue)).not.toContain('comments');
  });

  it('score and comments are optional', async () => {
    const { service, repo } = makeService({
      repo: {
        create: vi
          .fn()
          .mockResolvedValue(feedbackRow({ score: null, comments: null })),
      },
    });
    await service.create(
      { customerId: 'cust-1', context: 'post_issuance' },
      'u-sales',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ score: null, comments: null }),
    );
  });

  it('a backdated submittedAt is parsed; a future one is rejected (422)', async () => {
    const { service, repo } = makeService();
    await service.create(
      {
        customerId: 'cust-1',
        context: 'post_renewal',
        submittedAt: '2026-09-01T09:00:00.000Z',
      },
      'u-sales',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        submittedAt: new Date('2026-09-01T09:00:00.000Z'),
      }),
    );
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          context: 'post_renewal',
          submittedAt: '2999-01-01T00:00:00.000Z',
        },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a failed audit write never breaks the create', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const v = await service.create(
      { customerId: 'cust-1', context: 'post_claim' },
      'u-sales',
    );
    expect(v.id).toBe('fb-1');
  });
});

describe('FeedbackService reads (Process 45)', () => {
  it('get() 404s for an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list() maps rows to views and passes the filters through', async () => {
    const { service, repo } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue([feedbackRow()]) },
    });
    const rows = await service.list({
      customerId: 'cust-1',
      context: 'post_claim',
    });
    expect(rows).toHaveLength(1);
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', context: 'post_claim' }),
      5000,
    );
  });
});
