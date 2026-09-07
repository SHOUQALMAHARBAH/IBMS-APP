import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PrivacyNoticeService } from './privacy-notice.service';
import type { PrivacyNoticeRepository } from '../../repositories/privacy-notice.repository';
import type { AuditService } from '../audit/audit.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'pn-1',
  touchpoint: 'onboarding_kyc',
  versionNumber: 1,
  textAr: '...',
  textEn: 'We collect your data to perform KYC checks.',
  legallyReviewedAt: null,
  publishedAt: new Date('2026-09-07T00:00:00.000Z'),
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    nextVersionNumber: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    findCurrent: vi.fn().mockResolvedValue(row()),
    recordLegalReview: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PrivacyNoticeService(
    repo as unknown as PrivacyNoticeRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('PrivacyNoticeService.create', () => {
  it('computes the next version number for the touchpoint and creates', async () => {
    const { service, repo } = makeService({
      repo: { nextVersionNumber: vi.fn().mockResolvedValue(3) },
    });
    await service.create(
      { touchpoint: 'onboarding_kyc', textAr: '...', textEn: '...' },
      'u-dpo',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        touchpoint: 'onboarding_kyc',
        versionNumber: 3,
      }),
    );
  });

  it('409s a concurrent publish race for the same touchpoint+version', async () => {
    const { service } = makeService({
      repo: { create: vi.fn().mockRejectedValue(p2002()) },
    });
    await expect(
      service.create(
        { touchpoint: 'onboarding_kyc', textAr: '...', textEn: '...' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PrivacyNoticeService.current', () => {
  it('wraps a null result — { notice: null } when no version has ever been published', async () => {
    const { service } = makeService({
      repo: { findCurrent: vi.fn().mockResolvedValue(null) },
    });
    expect(await service.current('claims')).toEqual({ notice: null });
  });

  it('returns the highest-version notice for a touchpoint, wrapped', async () => {
    const { service, repo } = makeService();
    const v = await service.current('onboarding_kyc');
    expect(repo.findCurrent).toHaveBeenCalledWith('onboarding_kyc');
    expect(v.notice?.touchpoint).toBe('onboarding_kyc');
  });
});

describe('PrivacyNoticeService.recordLegalReview', () => {
  it('stamps legallyReviewedAt', async () => {
    const { service, repo } = makeService();
    await service.recordLegalReview('pn-1', 'u-dpo');
    expect(repo.recordLegalReview).toHaveBeenCalledWith(
      'pn-1',
      expect.any(Date),
    );
  });

  it('422s a re-review of an already-reviewed notice', async () => {
    const { service } = makeService({
      repo: { recordLegalReview: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.recordLegalReview('pn-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('PrivacyNoticeService.get/list', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists, forwarding the touchpoint filter', async () => {
    const { service, repo } = makeService();
    await service.list({ touchpoint: 'claims' });
    expect(repo.findMany).toHaveBeenCalledWith(
      { touchpoint: 'claims' },
      expect.any(Number),
    );
  });
});
