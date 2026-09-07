import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ComplianceCalendarService } from './compliance-calendar.service';
import type { ComplianceCalendarRepository } from '../../repositories/compliance-calendar.repository';
import type { AuditService } from '../audit/audit.service';
import type { CreateComplianceCalendarItemDto } from './dto/create-compliance-calendar-item.dto';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    obligationName: 'Quarterly CBJ prudential return',
    ownerUserId: 'user-1',
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
    evidenceOfSubmissionRef: null,
    submittedAt: null,
    ...overrides,
  };
}

function makeDeps() {
  const userExists = vi.fn().mockResolvedValue(true);
  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(row(input)),
    );
  const findById = vi.fn().mockResolvedValue(row());
  const findMany = vi.fn().mockResolvedValue([row()]);
  const recordSubmission = vi.fn().mockResolvedValue({ count: 1 });
  const repo = {
    userExists,
    create,
    findById,
    findMany,
    recordSubmission,
  } as unknown as ComplianceCalendarRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new ComplianceCalendarService(repo, audit),
    mocks: { userExists, create, findById, findMany, recordSubmission, record },
  };
}

const CREATE_DTO: CreateComplianceCalendarItemDto = {
  obligationName: 'Quarterly CBJ prudential return',
  ownerUserId: 'user-1',
  dueDate: '2026-10-01',
};

describe('ComplianceCalendarService (Process 51)', () => {
  describe('create', () => {
    it('404s on an unknown ownerUserId', async () => {
      const { service, mocks } = makeDeps();
      mocks.userExists.mockResolvedValue(false);
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates the item and audits CREATE', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.create(CREATE_DTO, 'compliance-1');
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ obligationName: CREATE_DTO.obligationName }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'ComplianceCalendarItem',
        }),
      );
      expect(view.isSubmitted).toBe(false);
    });
  });

  describe('recordSubmission', () => {
    it('404s on an unknown item', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);
      await expect(
        service.recordSubmission(
          'missing',
          { evidenceOfSubmissionRef: 'doc://ref-1' },
          'compliance-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('stamps the submission and audits UPDATE', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValueOnce(row()); // pre-check
      mocks.findById.mockResolvedValueOnce(
        row({
          evidenceOfSubmissionRef: 'doc://ref-1',
          submittedAt: new Date('2026-09-05'),
        }),
      ); // post-write reload
      const view = await service.recordSubmission(
        'item-1',
        { evidenceOfSubmissionRef: 'doc://ref-1' },
        'compliance-1',
      );
      expect(view.isSubmitted).toBe(true);
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('409s on a second submission attempt (write-once)', async () => {
      const { service, mocks } = makeDeps();
      mocks.recordSubmission.mockResolvedValue({ count: 0 });
      await expect(
        service.recordSubmission(
          'item-1',
          { evidenceOfSubmissionRef: 'doc://ref-2' },
          'compliance-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a future submittedAt (a record of something that already happened)', async () => {
      const { service } = makeDeps();
      await expect(
        service.recordSubmission(
          'item-1',
          {
            evidenceOfSubmissionRef: 'doc://ref-1',
            submittedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
          'compliance-1',
        ),
      ).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('passes ownerUserId / overdueOnly filters through to the repository', async () => {
      const { service, mocks } = makeDeps();
      await service.list({ ownerUserId: 'user-1', overdueOnly: true });
      expect(mocks.findMany).toHaveBeenCalledWith(
        { ownerUserId: 'user-1', overdueOnly: true },
        expect.any(Date),
        expect.any(Number),
      );
    });
  });

  describe('get', () => {
    it('404s on an unknown id', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);
      await expect(service.get('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
