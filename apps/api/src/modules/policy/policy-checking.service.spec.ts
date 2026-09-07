import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PolicyCheckingService } from './policy-checking.service';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { PolicyCheckingRepository } from '../../repositories/policy-checking.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { PolicyService } from './policy.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RecordPolicyCheckingDto } from './dto/record-policy-checking.dto';

function checker(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'chk-1',
    email: 'chk@ibms.test',
    roles: ['POLICY_CHECKING_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

const MATCHING_DTO = {
  requestedCoverage: {
    limits: { buildings: '5000000.000' },
    sumsInsured: { total: '5000000.000' },
    namedPerils: ['fire', 'flood'],
    extensions: ['debris removal'],
  },
} as unknown as RecordPolicyCheckingDto;

const DISCREPANT_DTO = {
  requestedCoverage: {
    limits: { buildings: '5000000.000' },
    sumsInsured: { total: '5000000.000' },
    namedPerils: ['fire', 'flood', 'theft'], // theft missing from the issued schedule
    extensions: ['debris removal'],
  },
} as unknown as RecordPolicyCheckingDto;

interface Opts {
  policyStatus?: string;
  placedByUserId?: string | null;
  issuedByUserId?: string | null;
  /** PolicyService.loadVisible rejects (the caller can't see the policy). */
  notVisible?: boolean;
  existingChecking?: { discrepancyLoggedAsPiRiskEvent: boolean } | null;
  transitionRejects?: boolean;
  noSchedule?: boolean;
  /** findStatus returns ISSUED once (so the first hop applies) then VERIFIED
   * — simulates a concurrent divergent check verifying the policy mid-walk. */
  concurrentVerifyDuringWalk?: boolean;
}

function makeDeps(opts: Opts = {}) {
  const state = {
    status: opts.policyStatus ?? 'ISSUED',
    lastPiRiskEvent: 'unset' as unknown,
  };

  const policyRow = () => ({
    id: 'pol-1',
    opportunityId: 'opp-1',
    customerId: 'cust-1',
    insurerId: 'ins-1',
    policyNumber: 'POL-1',
    insuranceLine: 'Property All Risks',
    status: state.status,
    placedByUserId:
      opts.placedByUserId === undefined ? 'plc-1' : opts.placedByUserId,
    issuedByUserId:
      opts.issuedByUserId === undefined ? 'iss-1' : opts.issuedByUserId,
    schedules: opts.noSchedule
      ? []
      : [
          {
            id: 'sch-1',
            effectiveTo: null,
            limits: { buildings: '5000000.000' },
            sumsInsured: { total: '5000000.000' },
            namedPerils: ['fire', 'flood'],
            extensions: ['debris removal'],
          },
        ],
    documents: [],
    checking: opts.existingChecking ?? null,
  });

  let findStatusCalls = 0;
  const findStatus = vi.fn().mockImplementation(() => {
    findStatusCalls += 1;
    if (opts.concurrentVerifyDuringWalk && findStatusCalls > 1) {
      return Promise.resolve({ id: 'pol-1', status: 'VERIFIED' });
    }
    return Promise.resolve({ id: 'pol-1', status: state.status });
  });
  const policies = { findStatus } as unknown as PolicyRepository;

  const recordChecking = vi
    .fn<
      (input: {
        discrepancyFound: boolean;
        piRiskEvent: unknown;
      }) => Promise<unknown>
    >()
    .mockImplementation((input) => {
      state.lastPiRiskEvent = input.piRiskEvent;
      return Promise.resolve({
        id: 'chk-row-1',
        policyId: 'pol-1',
        placedByUserId: 'plc-1',
        checkedByUserId: 'chk-1',
        discrepancyFound: input.discrepancyFound,
        discrepancyLoggedAsPiRiskEvent:
          input.piRiskEvent !== null &&
          !opts.existingChecking?.discrepancyLoggedAsPiRiskEvent,
      });
    });
  const findLatestPiPolicyId = vi.fn().mockResolvedValue(null);
  const checkings = {
    recordChecking,
    findLatestPiPolicyId,
  } as unknown as PolicyCheckingRepository;

  const record = vi
    .fn<(input: { action: string; entityType: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn<(p: { toStatus: string }) => Promise<unknown>>()
    .mockImplementation((p) => {
      if (opts.transitionRejects) {
        return Promise.reject(new Error('status changed concurrently'));
      }
      state.status = p.toStatus;
      return Promise.resolve({ id: 'pol-1', status: p.toStatus });
    });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  const loadVisible = vi.fn().mockImplementation(() => {
    if (opts.notVisible) {
      return Promise.reject(new NotFoundException('Policy not found'));
    }
    return Promise.resolve(policyRow());
  });
  const get = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ id: 'pol-1', status: state.status }),
    );
  const policyService = { loadVisible, get } as unknown as PolicyService;

  return {
    service: new PolicyCheckingService(
      checkings,
      policies,
      audit,
      workflow,
      policyService,
    ),
    state,
    mocks: {
      loadVisible,
      findStatus,
      recordChecking,
      findLatestPiPolicyId,
      record,
      transition,
      get,
    },
  };
}

describe('PolicyCheckingService.check', () => {
  it('records a clean check, audits APPROVE, and walks the policy ISSUED -> CHECKING_IN_PROGRESS -> VERIFIED', async () => {
    const { service, mocks, state } = makeDeps();

    await service.check('pol-1', MATCHING_DTO, checker());

    expect(mocks.recordChecking).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'pol-1',
        placedByUserId: 'plc-1',
        checkedByUserId: 'chk-1',
        discrepancyFound: false,
        discrepancyDetail: null,
        piRiskEvent: null,
      }),
    );
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE',
        entityType: 'PolicyChecking',
      }),
    );
    expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
      'CHECKING_IN_PROGRESS',
      'VERIFIED',
    ]);
    expect(state.status).toBe('VERIFIED');
    expect(mocks.findLatestPiPolicyId).not.toHaveBeenCalled();
  });

  it('records a discrepancy, passes a PI risk event to the repo, audits REJECT, and walks to DISCREPANCY', async () => {
    const { service, mocks, state } = makeDeps();

    await service.check('pol-1', DISCREPANT_DTO, checker());

    expect(mocks.findLatestPiPolicyId).toHaveBeenCalled();
    expect(mocks.recordChecking).toHaveBeenCalledWith(
      expect.objectContaining({ discrepancyFound: true }),
    );
    // a PI risk event is passed to the repo on a discrepancy — its description
    // is unit-tested in policy-checking.config.spec.ts and asserted
    // end-to-end in policy.e2e-spec.ts
    expect(state.lastPiRiskEvent).not.toBeNull();
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REJECT' }),
    );
    expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
      'CHECKING_IN_PROGRESS',
      'DISCREPANCY',
    ]);
    expect(state.status).toBe('DISCREPANCY');
  });

  it('403s when the checker is the officer who placed the cover (maker/checker)', async () => {
    const { service, mocks } = makeDeps();
    await expect(
      service.check('pol-1', MATCHING_DTO, checker({ id: 'plc-1' })),
    ).rejects.toThrow(ForbiddenException);
    expect(mocks.recordChecking).not.toHaveBeenCalled();
  });

  it('422s when the policy has no recorded placing officer', async () => {
    const { service } = makeDeps({ placedByUserId: null });
    await expect(
      service.check('pol-1', MATCHING_DTO, checker()),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('422s when the policy is not in a checkable state', async () => {
    const { service, mocks } = makeDeps({ policyStatus: 'VERIFIED' });
    await expect(
      service.check('pol-1', MATCHING_DTO, checker()),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('422s when the policy has no open coverage schedule to check against', async () => {
    const { service } = makeDeps({ noSchedule: true });
    await expect(
      service.check('pol-1', MATCHING_DTO, checker()),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('re-check from DISCREPANCY that is still dirty does not move the status and does not re-log (repo guards the PI event)', async () => {
    const { service, mocks } = makeDeps({
      policyStatus: 'DISCREPANCY',
      existingChecking: { discrepancyLoggedAsPiRiskEvent: true },
    });
    await service.check('pol-1', DISCREPANT_DTO, checker());
    expect(mocks.recordChecking).toHaveBeenCalled();
    // outcome (DISCREPANCY) already reached -> no transition
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('re-check from DISCREPANCY that now passes walks DISCREPANCY -> CHECKING_IN_PROGRESS -> VERIFIED', async () => {
    const { service, mocks, state } = makeDeps({
      policyStatus: 'DISCREPANCY',
      existingChecking: { discrepancyLoggedAsPiRiskEvent: true },
    });
    await service.check('pol-1', MATCHING_DTO, checker());
    expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
      'CHECKING_IN_PROGRESS',
      'VERIFIED',
    ]);
    expect(state.status).toBe('VERIFIED');
  });

  it('resumes a stalled walk — a check from CHECKING_IN_PROGRESS does the single remaining hop', async () => {
    const { service, mocks } = makeDeps({
      policyStatus: 'CHECKING_IN_PROGRESS',
    });
    await service.check('pol-1', MATCHING_DTO, checker());
    expect(mocks.transition.mock.calls.map((c) => c[0].toStatus)).toEqual([
      'VERIFIED',
    ]);
  });

  it('still records the QC result when a routing transition fails (best-effort walk)', async () => {
    const { service, mocks } = makeDeps({ transitionRejects: true });
    const view = await service.check('pol-1', MATCHING_DTO, checker());
    expect(mocks.recordChecking).toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalled();
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(view).toBeDefined();
  });

  it('409s when a discrepancy outcome can no longer be applied (a concurrent check verified the policy mid-walk)', async () => {
    const { service, mocks } = makeDeps({ concurrentVerifyDuringWalk: true });
    await expect(
      service.check('pol-1', DISCREPANT_DTO, checker()),
    ).rejects.toThrow(ConflictException);
    // the check + its PI risk event are still on record
    expect(mocks.recordChecking).toHaveBeenCalledWith(
      expect.objectContaining({ discrepancyFound: true }),
    );
  });

  it('403s when the checker is the officer who recorded the issuance (stricter-than-lex issuer segregation)', async () => {
    const { service, mocks } = makeDeps();
    await expect(
      service.check('pol-1', MATCHING_DTO, checker({ id: 'iss-1' })),
    ).rejects.toThrow(ForbiddenException);
    expect(mocks.recordChecking).not.toHaveBeenCalled();
  });

  it('maps a concurrent first-check unique violation to 409', async () => {
    const { service, mocks } = makeDeps();
    mocks.recordChecking.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.check('pol-1', MATCHING_DTO, checker()),
    ).rejects.toThrow(ConflictException);
  });

  it('404s a policy the caller cannot see (PolicyService.loadVisible rejects)', async () => {
    const { service, mocks } = makeDeps({ notVisible: true });
    await expect(
      service.check('pol-1', MATCHING_DTO, checker()),
    ).rejects.toThrow(NotFoundException);
    expect(mocks.recordChecking).not.toHaveBeenCalled();
  });
});
