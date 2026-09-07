import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { InsuranceProgramService } from './insurance-program.service';
import type { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import type { NeedsAssessmentRepository } from '../../repositories/needs-assessment.repository';
import type { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function placement(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'plc-1',
    email: 'placement@ibms.test',
    roles: ['PLACEMENT_TECHNICAL_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

const APPROVED_NA = {
  id: 'na-1',
  riskProfileId: 'rp-1',
  status: 'APPROVED' as const,
  recommendedCoverageLines: [
    'Property All Risks (Fire)',
    'Business Interruption',
    'Public Liability',
  ],
};

const BUILDING_ASSET = {
  id: 'asset-1',
  riskProfileId: 'rp-1',
  assetType: 'building',
  declaredValue: new Prisma.Decimal('500000'),
  annualGrossProfit: null,
  indemnityPeriodMonths: null,
  fleetVehicleCount: null,
};

function makeDeps() {
  const createProgram = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'prog-1',
        status: 'DRAFT',
        createdAt: new Date(),
        ...input,
      }),
    );
  const findProgramById = vi.fn();
  const findManyByCustomerId = vi.fn().mockResolvedValue([]);
  const findManyByRiskProfileId = vi.fn().mockResolvedValue([]);
  const createLines = vi.fn().mockResolvedValue({ count: 0 });
  const deleteLines = vi.fn().mockResolvedValue({ count: 0 });
  const programs = {
    create: createProgram,
    findById: findProgramById,
    findManyByCustomerId,
    findManyByRiskProfileId,
    createLines,
    deleteLines,
  } as unknown as InsuranceProgramRepository;

  const findAssessmentById = vi.fn().mockResolvedValue({ ...APPROVED_NA });
  const assessments = {
    findById: findAssessmentById,
  } as unknown as NeedsAssessmentRepository;

  const findRiskProfileById = vi.fn().mockResolvedValue({
    id: 'rp-1',
    customerId: 'cust-1',
    siteLabel: 'HQ',
  });
  const findAssetsByRiskProfileId = vi.fn().mockResolvedValue([BUILDING_ASSET]);
  const riskProfiles = {
    findById: findRiskProfileById,
    findAssetsByRiskProfileId,
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
    .mockResolvedValue({ id: 'prog-1', status: 'FINALIZED' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  // After assemble/reassemble/transition the service re-reads via findById.
  findProgramById.mockResolvedValue({
    id: 'prog-1',
    riskProfileId: 'rp-1',
    needsAssessmentId: 'na-1',
    assembledByUserId: 'plc-1',
    status: 'DRAFT',
    createdAt: new Date(),
    lines: [
      {
        id: 'line-1',
        insuranceProgramId: 'prog-1',
        insuranceLine: 'Property All Risks',
        sumInsuredBasis: new Prisma.Decimal('500000.000'),
      },
    ],
  });

  return {
    service: new InsuranceProgramService(
      programs,
      assessments,
      riskProfiles,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      createProgram,
      findProgramById,
      findManyByCustomerId,
      findManyByRiskProfileId,
      createLines,
      deleteLines,
      findAssessmentById,
      findRiskProfileById,
      findAssetsByRiskProfileId,
      findCustomerById,
      record,
      transition,
    },
  };
}

describe('InsuranceProgramService', () => {
  describe('assemble', () => {
    it('creates a DRAFT program and seeds Property / BI lines from the derived Sum Insured', async () => {
      const { service, mocks } = makeDeps();
      await service.assemble({ needsAssessmentId: 'na-1' }, placement());

      expect(mocks.createProgram).toHaveBeenCalledWith({
        riskProfileId: 'rp-1',
        needsAssessmentId: 'na-1',
        assembledByUserId: 'plc-1',
      });
      const lines = mocks.createLines.mock.calls[0][1] as {
        insuranceLine: string;
        sumInsuredBasis: Prisma.Decimal | null;
      }[];
      expect(lines.map((l) => l.insuranceLine)).toEqual([
        'Property All Risks',
        'Business Interruption',
        'Public Liability',
      ]);
      expect(lines[0].sumInsuredBasis?.toString()).toBe('500000');
      // BI has no annualGrossProfit in the survey -> 0, but assetCount > 0 so
      // it is a real (zero) figure, quantized.
      expect(lines[1].sumInsuredBasis?.toString()).toBe('0');
      expect(lines[2].sumInsuredBasis).toBeNull();
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'InsuranceProgram',
        }),
      );
    });

    it('refuses a needs assessment that is not APPROVED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        ...APPROVED_NA,
        status: 'REVIEWED',
      });
      await expect(
        service.assemble({ needsAssessmentId: 'na-1' }, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.createProgram).not.toHaveBeenCalled();
    });

    it('refuses an approved assessment that recommends no coverage lines', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue({
        ...APPROVED_NA,
        recommendedCoverageLines: [],
      });
      await expect(
        service.assemble({ needsAssessmentId: 'na-1' }, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuses a second live program for the same risk profile', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByRiskProfileId.mockResolvedValue([
        { id: 'prog-0', status: 'DRAFT' },
      ]);
      await expect(
        service.assemble({ needsAssessmentId: 'na-1' }, placement()),
      ).rejects.toThrow(ConflictException);
      expect(mocks.createProgram).not.toHaveBeenCalled();
    });

    it('allows a fresh program once the previous one is SUPERSEDED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findManyByRiskProfileId.mockResolvedValue([
        { id: 'prog-0', status: 'SUPERSEDED' },
      ]);
      await service.assemble({ needsAssessmentId: 'na-1' }, placement());
      expect(mocks.createProgram).toHaveBeenCalled();
    });

    it('404s a missing needs assessment', async () => {
      const { service, mocks } = makeDeps();
      mocks.findAssessmentById.mockResolvedValue(null);
      await expect(
        service.assemble({ needsAssessmentId: 'na-x' }, placement()),
      ).rejects.toThrow(NotFoundException);
    });

    it('hides an assessment on a customer the caller cannot see behind a 404', async () => {
      const { service, mocks } = makeDeps();
      // Placement can normally reach any customer — drop them to Sales, and
      // the customer is owned by a different Sales officer.
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.assemble(
          { needsAssessmentId: 'na-1' },
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('still returns the program when the audit write fails', async () => {
      const { service, mocks } = makeDeps();
      mocks.record.mockRejectedValueOnce(new Error('audit down'));
      const result = await service.assemble(
        { needsAssessmentId: 'na-1' },
        placement(),
      );
      expect(result.id).toBe('prog-1');
    });

    it('maps the partial-unique-index violation from a concurrent assemble to a 409', async () => {
      const { service, mocks } = makeDeps();
      // Pre-check passes (no live program yet), but the insert loses the
      // race and Postgres rejects it on InsuranceProgram_one_live_per_risk_profile.
      mocks.createProgram.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.assemble({ needsAssessmentId: 'na-1' }, placement()),
      ).rejects.toThrow(ConflictException);
      expect(mocks.createLines).not.toHaveBeenCalled();
    });

    it('audits the CREATE before writing the lines (recoverable on a partial failure)', async () => {
      const { service, mocks } = makeDeps();
      const order: string[] = [];
      mocks.record.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve(undefined);
      });
      mocks.createLines.mockImplementation(() => {
        order.push('lines');
        return Promise.resolve({ count: 3 });
      });
      await service.assemble({ needsAssessmentId: 'na-1' }, placement());
      expect(order).toEqual(['audit', 'lines']);
    });
  });

  describe('reassemble', () => {
    it('rewrites a DRAFT program’s lines from the current survey', async () => {
      const { service, mocks } = makeDeps();
      await service.reassemble('prog-1', placement());
      expect(mocks.deleteLines).toHaveBeenCalledWith('prog-1');
      expect(mocks.createLines).toHaveBeenCalled();
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entityType: 'InsuranceProgram',
        }),
      );
      const auditArg = mocks.record.mock.calls.at(-1)?.[0] as {
        afterValue: { reassembled: boolean };
      };
      expect(auditArg.afterValue.reassembled).toBe(true);
    });

    it('refuses to re-assemble a FINALIZED program', async () => {
      const { service, mocks } = makeDeps();
      mocks.findProgramById.mockResolvedValue({
        id: 'prog-1',
        riskProfileId: 'rp-1',
        needsAssessmentId: 'na-1',
        status: 'FINALIZED',
        lines: [],
      });
      await expect(service.reassemble('prog-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.deleteLines).not.toHaveBeenCalled();
    });
  });

  describe('finalize / reopen', () => {
    it('finalize moves DRAFT -> FINALIZED through the workflow engine', async () => {
      const { service, mocks } = makeDeps();
      await service.finalize('prog-1', placement());
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'InsuranceProgram',
          toStatus: 'FINALIZED',
          actorUserId: 'plc-1',
        }),
      );
    });

    it('reopen moves FINALIZED -> DRAFT through the workflow engine', async () => {
      const { service, mocks } = makeDeps();
      await service.reopen('prog-1', placement());
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'InsuranceProgram',
          toStatus: 'DRAFT',
        }),
      );
    });

    it('finalize refuses a program with no lines', async () => {
      const { service, mocks } = makeDeps();
      mocks.findProgramById.mockResolvedValue({
        id: 'prog-1',
        riskProfileId: 'rp-1',
        needsAssessmentId: 'na-1',
        status: 'DRAFT',
        lines: [],
      });
      await expect(service.finalize('prog-1', placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });
  });

  describe('get / list', () => {
    it('get returns the program with its derivation context', async () => {
      const { service } = makeDeps();
      const view = await service.get('prog-1', placement());
      expect(view.context.needsAssessmentId).toBe('na-1');
      expect(view.context.customerId).toBe('cust-1');
      expect(view.context.surveyComplete).toBe(true);
      expect(view.context.recommendedCoverageLines).toContain(
        'Property All Risks (Fire)',
      );
    });

    it('list resolves visibility against the customer then returns its programs', async () => {
      const { service, mocks } = makeDeps();
      await service.list('cust-1', placement());
      expect(mocks.findCustomerById).toHaveBeenCalledWith('cust-1');
      expect(mocks.findManyByCustomerId).toHaveBeenCalledWith('cust-1');
    });
  });
});
