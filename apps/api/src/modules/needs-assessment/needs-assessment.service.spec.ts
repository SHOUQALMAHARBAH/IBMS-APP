import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { NeedsAssessmentService } from './needs-assessment.service';
import { NEEDS_ASSESSMENT_QUESTIONS } from './needs-assessment.config';
import type { NeedsAssessmentRepository } from '../../repositories/needs-assessment.repository';
import type { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function answers(overrides: Record<string, boolean | number> = {}) {
  const base: Record<string, boolean | number> = {};
  for (const q of NEEDS_ASSESSMENT_QUESTIONS) {
    base[q.id] = q.type === 'number' ? 0 : false;
  }
  return { ...base, ...overrides };
}

function makeUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

const MANAGER = makeUser({
  id: 'manager-1',
  roles: ['BRANCH_DEPARTMENT_MANAGER'],
});

function makeDeps() {
  const createAssessment = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'na-1',
        status: 'DRAFT',
        reviewedByUserId: null,
        approvedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      }),
    );
  const findAssessmentById = vi.fn();
  const findManyAssessments = vi.fn().mockResolvedValue([]);
  const updateQuestionnaire = vi
    .fn()
    .mockImplementation((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ id, status: 'DRAFT', ...data }),
    );
  const assessments = {
    create: createAssessment,
    findById: findAssessmentById,
    findMany: findManyAssessments,
    updateQuestionnaire,
  } as unknown as NeedsAssessmentRepository;

  const findRiskProfileById = vi.fn().mockResolvedValue({
    id: 'rp-1',
    customerId: 'cust-1',
  });
  const riskProfiles = {
    findById: findRiskProfileById,
  } as unknown as RiskProfileRepository;

  const findCustomerById = vi.fn().mockResolvedValue({
    id: 'cust-1',
    ownerUserId: 'sales-1',
  });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn()
    .mockResolvedValue({ id: 'na-1', status: 'PENDING_REVIEW' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new NeedsAssessmentService(
      assessments,
      riskProfiles,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      createAssessment,
      findAssessmentById,
      findManyAssessments,
      updateQuestionnaire,
      findRiskProfileById,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('NeedsAssessmentService', () => {
  describe('create', () => {
    it('derives the coverage list from the answers and stamps the capturer', async () => {
      const { service, mocks } = makeDeps();
      const result = await service.create(
        {
          riskProfileId: 'rp-1',
          questionnaireAnswers: answers({
            ownsOrLeasesPremises: true,
            employeeCount: 4,
          }),
        },
        makeUser(),
      );
      expect(mocks.createAssessment).toHaveBeenCalledWith(
        expect.objectContaining({
          riskProfileId: 'rp-1',
          createdByUserId: 'sales-1',
          recommendedCoverageLines: [
            'Property All Risks (Fire)',
            'Workers Compensation',
          ],
        }),
      );
      expect(result.status).toBe('DRAFT');
    });

    it('rejects an invalid questionnaire before writing anything', async () => {
      const { service, mocks } = makeDeps();
      await expect(
        service.create(
          {
            riskProfileId: 'rp-1',
            questionnaireAnswers: { ownsOrLeasesPremises: 'yes' },
          },
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createAssessment).not.toHaveBeenCalled();
    });

    it("hides another officer's risk profile behind the same NotFoundException as a missing one", async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.create(
          { riskProfileId: 'rp-1', questionnaireAnswers: answers() },
          makeUser(),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.createAssessment).not.toHaveBeenCalled();
    });

    it('still returns the created assessment when the audit write fails', async () => {
      const { service, mocks } = makeDeps();
      mocks.record.mockRejectedValueOnce(new Error('audit down'));
      const result = await service.create(
        { riskProfileId: 'rp-1', questionnaireAnswers: answers() },
        makeUser(),
      );
      expect(result.id).toBe('na-1');
    });
  });

  describe('update', () => {
    it('re-derives the coverage list and only touches a DRAFT assessment', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'DRAFT',
        createdByUserId: 'sales-1',
      });
      await service.update(
        'na-1',
        { questionnaireAnswers: answers({ operatesVehicleFleet: true }) },
        makeUser(),
      );
      expect(mocks.updateQuestionnaire).toHaveBeenCalledWith(
        'na-1',
        expect.objectContaining({
          recommendedCoverageLines: ['Motor Fleet'],
        }),
      );
    });

    it('rejects an edit once the assessment has left DRAFT', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'PENDING_REVIEW',
        createdByUserId: 'sales-1',
      });
      await expect(
        service.update('na-1', { questionnaireAnswers: answers() }, makeUser()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects an edit by anyone other than the capturer (even a cross-owner viewer)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'DRAFT',
        createdByUserId: 'sales-1',
      });
      await expect(
        service.update('na-1', { questionnaireAnswers: answers() }, MANAGER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('submit', () => {
    it('moves a DRAFT assessment to PENDING_REVIEW for its capturer', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'DRAFT',
        createdByUserId: 'sales-1',
      });
      await service.submit('na-1', makeUser());
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'NeedsAssessment',
          toStatus: 'PENDING_REVIEW',
          actorUserId: 'sales-1',
        }),
      );
    });

    it("won't let a different officer submit someone else's draft", async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'DRAFT',
        createdByUserId: 'sales-2',
      });
      await expect(
        service.submit('na-1', makeUser({ id: 'sales-1' })),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });
  });

  describe('review / approve — maker/checker', () => {
    it('rejects a review by the same user who captured the assessment', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'PENDING_REVIEW',
        createdByUserId: 'manager-1',
      });
      await expect(service.review('na-1', MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('stamps reviewedByUserId through the transition on a valid review', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'PENDING_REVIEW',
        createdByUserId: 'sales-1',
      });
      await service.review('na-1', MANAGER);
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: 'REVIEWED',
          data: { reviewedByUserId: 'manager-1' },
        }),
      );
    });

    it('rejects an approval by the capturer and stamps approvedByUserId otherwise', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'REVIEWED',
        createdByUserId: 'manager-1',
      });
      await expect(service.approve('na-1', MANAGER)).rejects.toThrow(
        ForbiddenException,
      );

      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'REVIEWED',
        createdByUserId: 'sales-1',
      });
      await service.approve('na-1', MANAGER);
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: 'APPROVED',
          data: { approvedByUserId: 'manager-1' },
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVE' }),
      );
    });
  });

  describe('returnToDraft / reject', () => {
    it('requires a reason to return an assessment for changes and clears the stale review', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'REVIEWED',
        createdByUserId: 'sales-1',
      });
      await expect(
        service.returnToDraft('na-1', '  ', MANAGER),
      ).rejects.toThrow(BadRequestException);

      await service.returnToDraft('na-1', 'coverage list looks wrong', MANAGER);
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: 'DRAFT',
          data: { reviewedByUserId: null },
        }),
      );
    });

    it('requires a reason to reject and enforces maker/checker', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'PENDING_REVIEW',
        createdByUserId: 'manager-1',
      });
      await expect(
        service.reject('na-1', 'not proceeding', MANAGER),
      ).rejects.toThrow(ForbiddenException);

      mocks.findAssessmentById.mockResolvedValue({
        id: 'na-1',
        status: 'PENDING_REVIEW',
        createdByUserId: 'sales-1',
      });
      await expect(service.reject('na-1', '', MANAGER)).rejects.toThrow(
        BadRequestException,
      );

      await service.reject('na-1', 'client not proceeding', MANAGER);
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'REJECTED' }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REJECT' }),
      );
    });
  });

  describe('list', () => {
    it('scopes a Sales Officer to their own captured assessments', async () => {
      const { service, mocks } = makeDeps();
      await service.list({}, makeUser({ id: 'sales-1' }));
      expect(mocks.findManyAssessments).toHaveBeenCalledWith({
        riskProfileId: undefined,
        status: undefined,
        createdByUserId: 'sales-1',
      });
    });

    it('lets a Manager see every capturer', async () => {
      const { service, mocks } = makeDeps();
      await service.list({ status: 'PENDING_REVIEW' }, MANAGER);
      expect(mocks.findManyAssessments).toHaveBeenCalledWith({
        riskProfileId: undefined,
        status: 'PENDING_REVIEW',
        createdByUserId: undefined,
      });
    });
  });
});
