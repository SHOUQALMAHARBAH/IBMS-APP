import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { KycService } from './kyc.service';
import type { KycRecordRepository } from '../../repositories/kyc-record.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { ScreeningService } from './screening.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function makeUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

function makeDeps() {
  const findById = vi.fn();
  const findLatestByCustomerId = vi.fn().mockResolvedValue(null);
  const create = vi
    .fn()
    .mockImplementation((input) =>
      Promise.resolve({ id: 'kyc-1', status: 'DRAFT', isEdd: false, ...input }),
    );
  const update = vi.fn().mockResolvedValue({});
  const findRiskRatingByKycRecordId = vi.fn().mockResolvedValue(null);
  // Default: screening has run (one result row) — the "no screening" case
  // overrides this to [].
  const findScreeningResultsByKycRecordId = vi
    .fn()
    .mockResolvedValue([{ id: 'sr-1' }]);
  const findMany = vi.fn().mockResolvedValue([]);
  const kycRecords = {
    findById,
    findLatestByCustomerId,
    create,
    update,
    findRiskRatingByKycRecordId,
    findScreeningResultsByKycRecordId,
    findMany,
  } as unknown as KycRecordRepository;

  const findCustomerById = vi.fn();
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn()
    .mockImplementation(
      (params: {
        entityType: string;
        entityId: string;
        toStatus: string;
        actorUserId: string;
        data?: Record<string, unknown>;
      }) => Promise.resolve({ id: params.entityId, status: params.toStatus }),
    );
  const workflow = { transition } as unknown as WorkflowTransitionService;

  const run = vi.fn().mockResolvedValue({
    results: [],
    riskLevel: 'STANDARD',
    isEdd: false,
    newHit: false,
  });
  const screening = { run } as unknown as ScreeningService;

  const computeDueAt = vi.fn().mockReturnValue(new Date('2026-09-05'));
  const startTimer = vi.fn().mockResolvedValue([]);
  const resolve = vi.fn().mockResolvedValue({ count: 1 });
  const sla = {
    computeDueAt,
    startTimer,
    resolve,
  } as unknown as SlaTimerService;

  return {
    service: new KycService(
      kycRecords,
      customers,
      audit,
      workflow,
      screening,
      sla,
    ),
    mocks: {
      findById,
      findLatestByCustomerId,
      create,
      update,
      findRiskRatingByKycRecordId,
      findScreeningResultsByKycRecordId,
      findMany,
      findCustomerById,
      record,
      transition,
      run,
      computeDueAt,
      startTimer,
      resolve,
    },
  };
}

describe('KycService', () => {
  describe('start', () => {
    it("throws NotFoundException for another officer's customer", async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });

      await expect(service.start('cust-1', 'sales-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('rejects starting a second KYC file while one is already in progress', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-1',
      });
      mocks.findLatestByCustomerId.mockResolvedValue({
        id: 'kyc-0',
        status: 'SCREENING',
      });

      await expect(service.start('cust-1', 'sales-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('allows starting a new KYC file once the prior one reached a terminal status', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-1',
      });
      mocks.findLatestByCustomerId.mockResolvedValue({
        id: 'kyc-0',
        status: 'REJECTED',
      });

      const kyc = await service.start('cust-1', 'sales-1');

      expect(kyc.id).toBe('kyc-1');
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          createdByUserId: 'sales-1',
        }),
      );
    });
  });

  describe('submit', () => {
    it("hides another officer's KYCRecord behind NotFoundException", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-2',
        status: 'DRAFT',
      });

      await expect(service.submit('kyc-1', 'sales-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('transitions DRAFT -> SUBMITTED and stamps submittedAt', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById
        .mockResolvedValueOnce({
          id: 'kyc-1',
          createdByUserId: 'sales-1',
          status: 'DRAFT',
        })
        .mockResolvedValueOnce({
          id: 'kyc-1',
          createdByUserId: 'sales-1',
          status: 'SUBMITTED',
        });

      const result = await service.submit('kyc-1', 'sales-1');

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'KYCRecord',
          toStatus: 'SUBMITTED',
        }),
      );
      const [[call]] = mocks.transition.mock.calls as [
        [{ data?: { submittedAt?: Date } }],
      ];
      expect(call.data?.submittedAt).toBeInstanceOf(Date);
      expect(result.status).toBe('SUBMITTED');
    });
  });

  describe('runScreening', () => {
    it('runs ScreeningService BEFORE the SCREENING transition, then starts the standard SLA timer when clear', async () => {
      const { service, mocks } = makeDeps();
      mocks.run.mockResolvedValue({
        results: [],
        riskLevel: 'STANDARD',
        isEdd: false,
        newHit: false,
      });
      mocks.findById
        .mockResolvedValueOnce({
          id: 'kyc-1',
          status: 'SUBMITTED',
          isEdd: false,
        })
        .mockResolvedValue({ id: 'kyc-1', status: 'SCREENING', isEdd: false });

      await service.runScreening('kyc-1', 'compliance-1');

      // Order matters: a screening failure must leave the file retriable in
      // SUBMITTED, not stranded in SCREENING.
      expect(mocks.run.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.transition.mock.invocationCallOrder[0],
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'SCREENING' }),
      );
      expect(mocks.run).toHaveBeenCalledWith('kyc-1', 'compliance-1');
      expect(mocks.computeDueAt).toHaveBeenCalledWith(
        'kyc_standard_review',
        expect.any(Date),
      );
      expect(mocks.startTimer).toHaveBeenCalledWith(
        expect.objectContaining({ workflowName: 'kyc_standard_review' }),
      );
    });

    it('starts the EDD (longer) SLA timer when screening produces a HIT', async () => {
      const { service, mocks } = makeDeps();
      mocks.run.mockResolvedValue({
        results: [],
        riskLevel: 'HIGH',
        isEdd: true,
        newHit: true,
      });
      mocks.findById
        .mockResolvedValueOnce({
          id: 'kyc-1',
          status: 'SUBMITTED',
          isEdd: false,
        })
        .mockResolvedValue({ id: 'kyc-1', status: 'SCREENING', isEdd: true });

      await service.runScreening('kyc-1', 'compliance-1');

      expect(mocks.computeDueAt).toHaveBeenCalledWith(
        'kyc_edd_review',
        expect.any(Date),
      );
      expect(mocks.startTimer).toHaveBeenCalledWith(
        expect.objectContaining({ workflowName: 'kyc_edd_review' }),
      );
    });

    it('rejects run-screening for a file that is not SUBMITTED (nothing screened, no transition)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', status: 'SCREENING' });

      await expect(
        service.runScreening('kyc-1', 'compliance-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('still succeeds (file in SCREENING with results) when the SLA-timer start fails', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById
        .mockResolvedValueOnce({
          id: 'kyc-1',
          status: 'SUBMITTED',
          isEdd: false,
        })
        .mockResolvedValue({ id: 'kyc-1', status: 'SCREENING', isEdd: false });
      mocks.startTimer.mockRejectedValueOnce(new Error('sla down'));

      const result = await service.runScreening('kyc-1', 'compliance-1');

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'SCREENING' }),
      );
      expect(result.status).toBe('SCREENING');
    });
  });

  describe('triggerEdd', () => {
    it('rejects triggering EDD when screening found nothing (isEdd false)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', isEdd: false });

      await expect(service.triggerEdd('kyc-1', 'compliance-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('transitions SCREENING -> EDD when isEdd is true', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        isEdd: true,
        status: 'EDD',
      });

      await service.triggerEdd('kyc-1', 'compliance-1');

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'EDD' }),
      );
    });
  });

  describe('decide', () => {
    it('enforces maker/checker — rejects the capturing officer approving their own KYC file', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: false,
        customerId: 'cust-1',
      });

      await expect(
        service.decide('kyc-1', 'APPROVED', undefined, 'sales-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('requires a reason on REJECTED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: false,
        customerId: 'cust-1',
      });

      await expect(
        service.decide('kyc-1', 'REJECTED', undefined, 'compliance-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('blocks a decision while a high-risk result has not gone through trigger-edd yet', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: true,
        customerId: 'cust-1',
      });

      await expect(
        service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('approves: moves through COMPLIANCE_REVIEW to APPROVED, resolves the SLA timer, schedules the next review, and activates a PENDING_KYC Customer', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: false,
        customerId: 'cust-1',
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        level: 'STANDARD',
      });
      mocks.findCustomerById.mockResolvedValue({ status: 'PENDING_KYC' });

      await service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1');

      const toStatuses = mocks.transition.mock.calls.map(
        ([call]: [{ toStatus: string; entityType: string }]) =>
          `${call.entityType}:${call.toStatus}`,
      );
      expect(toStatuses).toEqual([
        'KYCRecord:COMPLIANCE_REVIEW',
        'KYCRecord:APPROVED',
        'Customer:ACTIVE',
      ]);
      expect(mocks.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ workflowName: 'kyc_standard_review' }),
      );
      const [, updateData] = mocks.update.mock.calls[0] as [
        string,
        { nextReviewDueAt?: Date },
      ];
      expect(updateData.nextReviewDueAt).toBeInstanceOf(Date);
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVE' }),
      );
    });

    it('a periodic re-KYC approval on an already-ACTIVE Customer does not re-transition it (and does not throw)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-2',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: false,
        customerId: 'cust-1',
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        level: 'STANDARD',
      });
      mocks.findCustomerById.mockResolvedValue({ status: 'ACTIVE' });

      await service.decide('kyc-2', 'APPROVED', undefined, 'compliance-1');

      const toStatuses = mocks.transition.mock.calls.map(
        ([call]: [{ toStatus: string; entityType: string }]) =>
          `${call.entityType}:${call.toStatus}`,
      );
      expect(toStatuses).toEqual([
        'KYCRecord:COMPLIANCE_REVIEW',
        'KYCRecord:APPROVED',
      ]);
      expect(toStatuses).not.toContain('Customer:ACTIVE');
    });

    it('rejects: moves through COMPLIANCE_REVIEW to REJECTED but never activates the Customer', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'EDD',
        isEdd: true,
        customerId: 'cust-1',
      });

      await service.decide(
        'kyc-1',
        'REJECTED',
        'adverse media',
        'compliance-1',
      );

      const toStatuses = mocks.transition.mock.calls.map(
        ([call]: [{ toStatus: string; entityType: string }]) =>
          `${call.entityType}:${call.toStatus}`,
      );
      expect(toStatuses).toEqual([
        'KYCRecord:COMPLIANCE_REVIEW',
        'KYCRecord:REJECTED',
      ]);
      expect(mocks.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ workflowName: 'kyc_edd_review' }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REJECT',
          afterValue: { reason: 'adverse media' },
        }),
      );
    });

    it('refuses to decide a file that has no ScreeningResult rows (interrupted runScreening)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: false,
        customerId: 'cust-1',
      });
      mocks.findScreeningResultsByKycRecordId.mockResolvedValue([]);

      await expect(
        service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('resumes a file left in COMPLIANCE_REVIEW by an interrupted earlier decide() — one transition, straight to the decision', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'COMPLIANCE_REVIEW',
        isEdd: false,
        customerId: 'cust-1',
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        level: 'STANDARD',
      });
      mocks.findCustomerById.mockResolvedValue({ status: 'PENDING_KYC' });

      await service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1');

      const toStatuses = mocks.transition.mock.calls.map(
        ([call]: [{ toStatus: string; entityType: string }]) =>
          `${call.entityType}:${call.toStatus}`,
      );
      // No second KYCRecord:COMPLIANCE_REVIEW — it is already there.
      expect(toStatuses).toEqual(['KYCRecord:APPROVED', 'Customer:ACTIVE']);
    });

    it('resumes an APPROVED file whose tail never finished — activates the still-PENDING_KYC Customer without re-transitioning the KYCRecord', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'APPROVED',
        isEdd: false,
        customerId: 'cust-1',
        nextReviewDueAt: null,
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        level: 'STANDARD',
      });
      mocks.findCustomerById.mockResolvedValue({ status: 'PENDING_KYC' });

      await service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1');

      const toStatuses = mocks.transition.mock.calls.map(
        ([call]: [{ toStatus: string; entityType: string }]) =>
          `${call.entityType}:${call.toStatus}`,
      );
      // Only the Customer activation runs — the KYCRecord is already APPROVED.
      expect(toStatuses).toEqual(['Customer:ACTIVE']);
      expect(mocks.resolve).toHaveBeenCalled();

      const [updateId, updateData] = mocks.update.mock.calls[0] as [
        string,
        { nextReviewDueAt?: Date },
      ];
      expect(updateId).toBe('kyc-1');
      expect(updateData.nextReviewDueAt).toBeInstanceOf(Date);

      const approveAudit = (
        mocks.record.mock.calls as [
          { action: string; afterValue?: { resumed?: boolean } },
        ][]
      )
        .map(([c]) => c)
        .find((c) => c.action === 'APPROVE');
      expect(approveAudit?.afterValue?.resumed).toBe(true);
    });

    it('still rejects a decision on a fully-finalised APPROVED file (review date set, Customer already ACTIVE)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'APPROVED',
        isEdd: false,
        customerId: 'cust-1',
        nextReviewDueAt: new Date('2027-01-01'),
      });
      mocks.findCustomerById.mockResolvedValue({ status: 'ACTIVE' });

      await expect(
        service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('does not fail an approval when the Customer was activated concurrently by another KYC approval', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        createdByUserId: 'sales-1',
        status: 'SCREENING',
        isEdd: false,
        customerId: 'cust-1',
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        level: 'STANDARD',
      });
      // Read #1 (before the transition) sees PENDING_KYC; the Customer:ACTIVE
      // transition then loses the race and throws; the re-check read sees
      // ACTIVE, so decide() swallows it instead of surfacing a 409.
      mocks.findCustomerById
        .mockResolvedValueOnce({ status: 'PENDING_KYC' })
        .mockResolvedValue({ status: 'ACTIVE' });
      mocks.transition.mockImplementation(
        (params: {
          entityType: string;
          toStatus: string;
          entityId: string;
        }) => {
          if (params.entityType === 'Customer') {
            return Promise.reject(
              new ConflictException('status changed concurrently'),
            );
          }
          return Promise.resolve({
            id: params.entityId,
            status: params.toStatus,
          });
        },
      );

      await expect(
        service.decide('kyc-1', 'APPROVED', undefined, 'compliance-1'),
      ).resolves.not.toThrow();
    });
  });

  describe('scheduleReview', () => {
    it('rejects a past nextReviewDueAt', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', status: 'APPROVED' });

      await expect(
        service.scheduleReview(
          'kyc-1',
          { nextReviewDueAt: '2020-01-01T00:00:00.000Z' },
          'compliance-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('accepts an explicit future nextReviewDueAt', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', status: 'APPROVED' });
      const future = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await service.scheduleReview(
        'kyc-1',
        { nextReviewDueAt: future },
        'compliance-1',
      );

      expect(mocks.update).toHaveBeenCalledWith(
        'kyc-1',
        expect.objectContaining({ nextReviewDueAt: new Date(future) }),
      );
    });

    it('computes the risk-based default when no explicit date is given', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', status: 'APPROVED' });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({ level: 'HIGH' });

      await service.scheduleReview('kyc-1', {}, 'compliance-1');

      const [, updateData] = mocks.update.mock.calls[0] as [
        string,
        { nextReviewDueAt: Date },
      ];
      expect(updateData.nextReviewDueAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects scheduling a review for a KYC file that is not APPROVED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', status: 'SCREENING' });

      await expect(
        service.scheduleReview('kyc-1', {}, 'compliance-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it("scopes a Sales Officer to their own customers' KYC records", async () => {
      const { service, mocks } = makeDeps();

      await service.list({}, makeUser({ id: 'sales-1' }));

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ customerOwnerUserId: 'sales-1' }),
      );
    });

    it('gives Compliance the whole queue, unscoped', async () => {
      const { service, mocks } = makeDeps();

      await service.list(
        {},
        makeUser({ id: 'compliance-1', roles: ['COMPLIANCE_OFFICER'] }),
      );

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ customerOwnerUserId: undefined }),
      );
    });
  });
});
