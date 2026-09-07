import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { ClaimService } from './claim.service';
import type { ClaimDocType } from './claim.config';
import { ClaimRepository } from '../../repositories/claim.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { EncryptionService } from '../security/encryption.service';
import type { LossRatioService } from '../loss-ratio/loss-ratio.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotifyClaimDto } from './dto/notify-claim.dto';
import type { RegisterClaimDto } from './dto/register-claim.dto';

const INCEPTION = new Date('2026-01-01T00:00:00.000Z');
const ENDORSED_AT = new Date('2026-06-01T00:00:00.000Z');
const EXPIRY = new Date('2027-01-01T00:00:00.000Z');

function claims(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'clm-1',
    email: 'claims@ibms.test',
    roles: ['CLAIMS_OFFICER'],
    sessionId: 's-1',
    ...overrides,
  };
}
/** Sales is scoped to Customers they own — used to exercise the not-visible
 * branch. */
function sales(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-9',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 's-9',
    ...overrides,
  };
}

interface Opts {
  /** [from, to) windows for the policy's PolicySchedule versions. */
  schedules?: { id: string; effectiveFrom: Date; effectiveTo: Date | null }[];
  expiryDate?: Date | null;
  customerOwner?: string;
  policyMissing?: boolean;
}

function makeDeps(opts: Opts = {}) {
  const schedules = opts.schedules ?? [
    { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: ENDORSED_AT },
    { id: 'sched-v2', effectiveFrom: ENDORSED_AT, effectiveTo: null },
  ];
  const expiryDate = opts.expiryDate === undefined ? EXPIRY : opts.expiryDate;

  const policyRow = {
    id: 'pol-1',
    customerId: 'cus-1',
    policyNumber: 'POL-1',
    insuranceLine: 'Property All Risks',
    status: 'ACTIVE',
    inceptionDate: INCEPTION,
    expiryDate,
    schedules,
  };

  const stored: Record<string, unknown>[] = [];
  // Mutable claim state the engine + registration mocks advance, so a
  // follow-up `findById` reflects it (matching the real atomic writes).
  const claimState = {
    status: 'NOTIFIED' as string,
    insurerClaimReference: null as string | null,
    claimNumber: null as string | null,
    adjuster: null as Record<string, unknown> | null,
    history: [] as Record<string, unknown>[],
    documents: [] as Record<string, unknown>[],
    followUpAlerts: [] as Record<string, unknown>[],
    settlement: null as Record<string, unknown> | null,
  };

  const claimRepo = {
    createNotification: vi
      .fn()
      .mockImplementation(
        (
          claim: Record<string, unknown>,
          tp: Record<string, unknown> | null,
        ) => {
          const row = {
            id: 'claim-1',
            classification: 'HIGHLY_CONFIDENTIAL',
            followUpAlertThresholdDays: 9,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...claim,
          };
          stored.push(row);
          claimState.history.push({
            fromStatus: null,
            toStatus: 'NOTIFIED',
            changedByUserId: claim.notifiedByUserId,
            changedAt: new Date(),
          });
          return Promise.resolve({
            claim: { ...row, status: 'NOTIFIED' },
            thirdParty: tp
              ? {
                  id: tp.id,
                  claimId: 'claim-1',
                  fullName: tp.fullName ?? null,
                  contactDetailsEnc: tp.contactDetailsEnc ?? null,
                  subrogationRecoveryFlag: tp.subrogationRecoveryFlag ?? false,
                }
              : null,
          });
        },
      ),
    recordRegistration: vi
      .fn()
      .mockImplementation(
        (input: {
          claimId: string;
          changedByUserId: string;
          adjuster: { name: string; firm: string | null };
        }) => {
          const created = claimState.history.every(
            (h) => h.toStatus !== 'REGISTERED',
          );
          if (created) {
            claimState.history.push({
              fromStatus: 'NOTIFIED',
              toStatus: 'REGISTERED',
              changedByUserId: input.changedByUserId,
              changedAt: new Date(),
            });
          }
          claimState.adjuster = {
            id: 'adj-1',
            claimId: input.claimId,
            name: input.adjuster.name,
            firm: input.adjuster.firm,
            assignedAt: new Date(),
            surveyCompletedAt: null,
            investigationCompletedAt: null,
          };
          // The claim is REGISTERED once its artefacts exist (in reality the
          // transition set this; on a resume it was already set).
          claimState.status = 'REGISTERED';
          return Promise.resolve(claimState.adjuster);
        },
      ),
    attachDocuments: vi.fn().mockImplementation(
      (
        claimId: string,
        docs: {
          docType: string;
          classification: string;
          fileName: string;
          storageRef: string;
          uploadedByUserId: string;
        }[],
      ) => {
        const created = docs.map((doc, i) => {
          const document = {
            id: `doc-${claimState.documents.length + i + 1}`,
            category: 'CLAIM',
            classification: doc.classification,
            fileName: doc.fileName,
            storageRef: doc.storageRef,
            versionNumber: 1,
            uploadedByUserId: doc.uploadedByUserId,
            createdAt: new Date(),
          };
          const link = {
            id: `cd-${claimState.documents.length + i + 1}`,
            claimId,
            documentId: document.id,
            docType: doc.docType,
            document,
          };
          claimState.documents.push(link);
          return link;
        });
        return Promise.resolve(created);
      },
    ),
    recordStatusHistory: vi
      .fn()
      .mockImplementation(
        (input: {
          claimId: string;
          fromStatus: string;
          toStatus: string;
          changedByUserId: string;
        }) => {
          if (claimState.history.every((h) => h.toStatus !== input.toStatus)) {
            claimState.history.push({
              fromStatus: input.fromStatus,
              toStatus: input.toStatus,
              changedByUserId: input.changedByUserId,
              changedAt: new Date(),
            });
          }
          return Promise.resolve(undefined);
        },
      ),
    recordAdjusterProgress: vi
      .fn()
      .mockImplementation(
        (
          _claimId: string,
          patch: { surveyCompletedAt?: Date; investigationCompletedAt?: Date },
        ) => {
          const a = claimState.adjuster;
          if (!a) throw new Error('no adjuster');
          const wrote = {
            surveyCompletedAt: false,
            investigationCompletedAt: false,
          };
          // write-once guard mirrors the repo's `<field> IS NULL` updateMany
          if (
            patch.surveyCompletedAt !== undefined &&
            a.surveyCompletedAt == null
          ) {
            a.surveyCompletedAt = patch.surveyCompletedAt;
            wrote.surveyCompletedAt = true;
          }
          if (
            patch.investigationCompletedAt !== undefined &&
            a.investigationCompletedAt == null
          ) {
            a.investigationCompletedAt = patch.investigationCompletedAt;
            wrote.investigationCompletedAt = true;
          }
          return Promise.resolve({ adjuster: a, wrote });
        },
      ),
    findById: vi.fn().mockImplementation(() => {
      const row = stored[stored.length - 1];
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        ...row,
        status: claimState.status,
        claimNumber: claimState.claimNumber,
        insurerClaimReference: claimState.insurerClaimReference,
        followUpAlertThresholdDays:
          (row.followUpAlertThresholdDays as number | undefined) ?? 9,
        policy: policyRow,
        thirdParty: row.isThirdPartyInvolved
          ? {
              id: 'tp-1',
              fullName: 'Third Party',
              contactDetailsEnc: 'enc:xxx',
              subrogationRecoveryFlag: false,
            }
          : null,
        adjuster: claimState.adjuster,
        documents: claimState.documents,
        followUpAlerts: claimState.followUpAlerts,
        settlement: claimState.settlement,
        statusHistory: claimState.history,
      });
    }),
    findManyByPolicyId: vi.fn().mockResolvedValue([]),
    findManyByCustomerId: vi.fn().mockResolvedValue([]),
    // Process 28 — settlement.
    createSettlement: vi
      .fn()
      .mockImplementation((input: Record<string, unknown>) => {
        claimState.settlement = {
          id: 'settlement-1',
          claimId: input.claimId,
          estimatedLoss: input.estimatedLoss,
          approvedAmount: input.approvedAmount,
          deductible: input.deductible,
          netSettlement: input.netSettlement,
          brokerProcessedPayment: input.brokerProcessedPayment,
          approvedByUserId: input.approvedByUserId,
          secondApproverUserId: null,
          clientPaymentConfirmedAt: null,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        };
        return Promise.resolve(claimState.settlement);
      }),
    recordSettlementSecondApproval: vi
      .fn()
      .mockImplementation((_id: string, secondApproverUserId: string) => {
        const s = claimState.settlement;
        if (!s || s.secondApproverUserId != null) return Promise.resolve(null);
        s.secondApproverUserId = secondApproverUserId;
        return Promise.resolve(s);
      }),
    // Process 29 — write-once client-payment-receipt stamp.
    confirmSettlementPayment: vi
      .fn()
      .mockImplementation((_id: string, at: Date) => {
        const s = claimState.settlement;
        if (!s) throw new Error('no settlement');
        let wrote = false;
        if (s.clientPaymentConfirmedAt == null) {
          s.clientPaymentConfirmedAt = at;
          wrote = true;
        }
        return Promise.resolve({ wrote, settlement: s });
      }),
    // Process 27 — the follow-up sweep. Default: nothing to do.
    findClaimsAwaitingInsurerResponse: vi.fn().mockResolvedValue([]),
    findOpenFollowUpAlertsForRespondedClaims: vi.fn().mockResolvedValue([]),
    raiseFollowUpAlert: vi.fn().mockImplementation((claimId: string) =>
      Promise.resolve({
        created: true,
        alert: {
          id: `fa-${claimId}`,
          claimId,
          triggeredAt: new Date(),
          resolvedAt: null,
        },
      }),
    ),
    resolveFollowUpAlert: vi.fn().mockResolvedValue(1),
  };

  const policyRepo = {
    findById: vi.fn().mockResolvedValue(opts.policyMissing ? null : policyRow),
  };

  const customerRepo = {
    findById: vi.fn().mockResolvedValue({
      id: 'cus-1',
      ownerUserId: opts.customerOwner ?? 'clm-1',
    }),
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const encryption = {
    encrypt: vi.fn().mockResolvedValue('enc:xxx'),
    decrypt: vi.fn(),
  };
  // Process 29 — the Loss Ratio recompute a closure triggers. Default: the
  // policy has no RenewalCase (the renewal module is not built), so it is a
  // no-op. A test can override `recomputed`.
  const lossRatio = {
    recomputeForPolicy: vi
      .fn()
      .mockResolvedValue({ recomputed: false, reason: 'no-renewal-case' }),
  };
  // The workflow engine — moves the claim's in-memory status + persists the
  // transition `data` scalars so a follow-up `findById` reflects the atomic
  // write the real engine performs.
  const workflow = {
    transition: vi
      .fn()
      .mockImplementation(
        (p: { toStatus: string; data?: Record<string, unknown> }) => {
          claimState.status = p.toStatus;
          if (typeof p.data?.insurerClaimReference === 'string') {
            claimState.insurerClaimReference = p.data.insurerClaimReference;
          }
          if (typeof p.data?.claimNumber === 'string') {
            claimState.claimNumber = p.data.claimNumber;
          }
          return Promise.resolve({ id: 'claim-1', status: p.toStatus });
        },
      ),
  };

  const service = new ClaimService(
    claimRepo as unknown as ClaimRepository,
    policyRepo as unknown as PolicyRepository,
    customerRepo as unknown as CustomerRepository,
    audit as unknown as AuditService,
    workflow as unknown as WorkflowTransitionService,
    encryption as unknown as EncryptionService,
    lossRatio as unknown as LossRatioService,
  );

  return {
    service,
    claimRepo,
    policyRepo,
    customerRepo,
    audit,
    workflow,
    encryption,
    lossRatio,
    claimState,
  };
}

const BASE_DTO: NotifyClaimDto = {
  policyId: 'pol-1',
  lossDate: '2026-03-15',
  causeOfLoss: 'Storm damage to the warehouse roof.',
  lossLocation: 'Unit 4, Sahab Industrial Estate',
  estimatedLoss: '20000.000',
};

describe('ClaimService.notify', () => {
  it('creates a claim at NOTIFIED and resolves coverage to the schedule version in force on the loss date', async () => {
    const { service, claimRepo, audit } = makeDeps();

    const view = await service.notify({ ...BASE_DTO }, claims());

    expect(view.status).toBe('NOTIFIED');
    expect(view.estimatedLoss).toBe('20000.000');
    expect(view.isThirdPartyInvolved).toBe(false);
    expect(view.isLargeClaim).toBe(false);
    expect(view.coverage?.scheduleId).toBe('sched-v1'); // NOT the current v2
    expect(view.coverageResolvedAtLossDate).toBe(true);
    expect(view.statusHistory).toHaveLength(1);
    expect(view.statusHistory[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'NOTIFIED',
      changedByUserId: 'clm-1',
    });

    const created = claimRepo.createNotification.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(created.notifiedByUserId).toBe('clm-1');
    expect((created.estimatedLoss as Prisma.Decimal).toString()).toBe('20000');

    const claimAudit = audit.record.mock.calls.find(
      (c) => (c[0] as { entityType: string }).entityType === 'Claim',
    );
    expect(claimAudit).toBeDefined();
    expect(
      (claimAudit?.[0] as { afterValue: Record<string, unknown> }).afterValue,
    ).toMatchObject({ coverageScheduleId: 'sched-v1' });
  });

  it('resolves a loss after the endorsement to the current open version', async () => {
    const { service, claimRepo } = makeDeps();
    // after ENDORSED_AT (2026-06-01), before "today"
    const view = await service.notify(
      { ...BASE_DTO, lossDate: '2026-07-15' },
      claims(),
    );
    expect(view.coverage?.scheduleId).toBe('sched-v2');
    expect(claimRepo.createNotification).toHaveBeenCalledOnce();
  });

  it('flags a large claim at or above the drafted threshold', async () => {
    const { service } = makeDeps();
    const view = await service.notify(
      { ...BASE_DTO, estimatedLoss: '25000.000' },
      claims(),
    );
    expect(view.isLargeClaim).toBe(true);
  });

  it('422 when the loss predates cover inception', async () => {
    const { service, claimRepo } = makeDeps();
    await expect(
      service.notify({ ...BASE_DTO, lossDate: '2025-12-15' }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(claimRepo.createNotification).not.toHaveBeenCalled();
  });

  it('422 when the loss is on or after the policy expiry (open schedule row notwithstanding)', async () => {
    const { service } = makeDeps();
    await expect(
      service.notify({ ...BASE_DTO, lossDate: '2027-02-01' }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422 when the policy has not been issued (no schedule)', async () => {
    const { service } = makeDeps({ schedules: [] });
    await expect(
      service.notify({ ...BASE_DTO }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422 when the estimated loss is zero', async () => {
    const { service } = makeDeps();
    await expect(
      service.notify({ ...BASE_DTO, estimatedLoss: '0' }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422 when the loss date is in the future', async () => {
    const { service } = makeDeps();
    await expect(
      service.notify({ ...BASE_DTO, lossDate: '2999-01-01' }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('records a third party: encrypts the contact details and audits the child row', async () => {
    const { service, claimRepo, encryption, audit } = makeDeps();
    const view = await service.notify(
      {
        ...BASE_DTO,
        isThirdPartyInvolved: true,
        thirdParty: {
          fullName: 'Ms Rana Odeh',
          contactDetails: '+962 7 9000 0000',
          subrogationRecoveryFlag: true,
        },
      },
      claims(),
    );
    expect(view.isThirdPartyInvolved).toBe(true);
    expect(view.thirdParty?.fullName).toBe('Third Party');
    expect(encryption.encrypt).toHaveBeenCalledOnce();
    const tpArg = claimRepo.createNotification.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(tpArg.contactDetailsEnc).toBe('enc:xxx');
    expect(tpArg.subrogationRecoveryFlag).toBe(true);
    const tpAudit = audit.record.mock.calls.find(
      (c) =>
        (c[0] as { entityType: string }).entityType === 'ThirdPartyClaimant',
    );
    expect(tpAudit).toBeDefined();
    expect(
      (tpAudit?.[0] as { afterValue: Record<string, unknown> }).afterValue,
    ).toMatchObject({ hasContactDetails: true, subrogationRecoveryFlag: true });
    // the plaintext never reaches the audit trail
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Rana Odeh');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('7 9000');
  });

  it('422 when thirdParty details are supplied without the involvement flag', async () => {
    const { service } = makeDeps();
    await expect(
      service.notify(
        {
          ...BASE_DTO,
          thirdParty: { fullName: 'Someone' },
        },
        claims(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('does not encrypt anything when the third party has no contact details', async () => {
    const { service, encryption, claimRepo } = makeDeps();
    await service.notify({ ...BASE_DTO, isThirdPartyInvolved: true }, claims());
    expect(encryption.encrypt).not.toHaveBeenCalled();
    const tpArg = claimRepo.createNotification.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(tpArg.contactDetailsEnc).toBeNull();
  });

  it('NotFound when the caller cannot see the policy owner', async () => {
    const { service } = makeDeps({ customerOwner: 'someone-else' });
    await expect(
      service.notify({ ...BASE_DTO }, sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClaimService reads', () => {
  it('get: coverageResolvedAtLossDate is false (not an error) when the policy was cancelled forward after notification', async () => {
    // policy schedule now closes at 2026-05-01; the claim's loss is 2026-06-10
    const { service, claimRepo } = makeDeps();
    // notify while cover was open
    await service.notify({ ...BASE_DTO, lossDate: '2026-06-10' }, claims());
    // simulate a later cancellation closing the only version before the loss
    claimRepo.findById.mockImplementationOnce(() =>
      Promise.resolve({
        id: 'claim-1',
        claimNumber: null,
        status: 'NOTIFIED',
        classification: 'HIGHLY_CONFIDENTIAL',
        followUpAlertThresholdDays: 9,
        customerId: 'cus-1',
        policyId: 'pol-1',
        lossDate: new Date('2026-06-10T00:00:00.000Z'),
        lossLocation: null,
        causeOfLoss: 'x',
        estimatedLoss: new Prisma.Decimal('20000'),
        isThirdPartyInvolved: false,
        isLargeClaim: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        policy: {
          id: 'pol-1',
          customerId: 'cus-1',
          policyNumber: 'POL-1',
          insuranceLine: 'Property All Risks',
          status: 'CANCELLED',
          inceptionDate: INCEPTION,
          expiryDate: EXPIRY,
          schedules: [
            {
              id: 'sched-v1',
              effectiveFrom: INCEPTION,
              effectiveTo: new Date('2026-05-01T00:00:00.000Z'),
            },
          ],
        },
        thirdParty: null,
        adjuster: null,
        documents: [],
        statusHistory: [],
        followUpAlerts: [],
        settlement: null,
      }),
    );
    const view = await service.get('claim-1', claims());
    expect(view.coverage).toBeNull();
    expect(view.coverageResolvedAtLossDate).toBe(false);
  });

  it('list: 422 unless exactly one scope is given', async () => {
    const { service } = makeDeps();
    await expect(service.list({}, claims())).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      service.list({ policyId: 'pol-1', customerId: 'cus-1' }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('list by policyId enforces policy visibility then returns rows', async () => {
    const { service, claimRepo } = makeDeps();
    await service.list({ policyId: 'pol-1' }, claims());
    expect(claimRepo.findManyByPolicyId).toHaveBeenCalledWith('pol-1');
  });

  it('get: records a sensitive-data-access READ audit (ids only, no claim content)', async () => {
    const { service, audit } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    audit.record.mockClear();
    await service.get('claim-1', claims());
    const read = audit.record.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'READ',
    );
    expect(read).toBeDefined();
    const entry = read?.[0] as {
      entityType: string;
      isSensitiveDataAccess: boolean;
      afterValue: Record<string, unknown>;
    };
    expect(entry.entityType).toBe('Claim');
    expect(entry.isSensitiveDataAccess).toBe(true);
    expect(entry.afterValue).toEqual({
      claimId: 'claim-1',
      policyId: 'pol-1',
      customerId: 'cus-1',
    });
    // no free text
    expect(JSON.stringify(entry.afterValue)).not.toMatch(
      /storm|warehouse|Sahab/i,
    );
  });

  it('list: flags the READ sensitive only when it returned a claim', async () => {
    const { service, claimRepo, audit } = makeDeps();

    await service.list({ policyId: 'pol-1' }, claims()); // findManyByPolicyId -> []
    let read = audit.record.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'READ',
    );
    expect(
      (read?.[0] as { isSensitiveDataAccess: boolean }).isSensitiveDataAccess,
    ).toBe(false);
    expect((read?.[0] as { entityType: string }).entityType).toBe('Policy');

    audit.record.mockClear();
    const row = (id: string) => ({
      id,
      claimNumber: null,
      status: 'NOTIFIED',
      classification: 'HIGHLY_CONFIDENTIAL',
      followUpAlertThresholdDays: 9,
      customerId: 'cus-1',
      policyId: 'pol-1',
      lossDate: new Date('2026-03-15T00:00:00.000Z'),
      lossLocation: null,
      causeOfLoss: 'x',
      estimatedLoss: new Prisma.Decimal('1000'),
      isThirdPartyInvolved: false,
      isLargeClaim: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      thirdParty: null,
      adjuster: null,
      documents: [],
      statusHistory: [],
      followUpAlerts: [],
      settlement: null,
      policy: {
        id: 'pol-1',
        customerId: 'cus-1',
        policyNumber: 'POL-1',
        insuranceLine: 'Property All Risks',
        expiryDate: EXPIRY,
        schedules: [
          { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
        ],
      },
    });
    claimRepo.findManyByCustomerId.mockResolvedValueOnce([
      row('claim-a'),
      row('claim-b'),
    ]);
    await service.list({ customerId: 'cus-1' }, claims());
    read = audit.record.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'READ',
    );
    const entry = read?.[0] as {
      entityType: string;
      isSensitiveDataAccess: boolean;
      afterValue: { count: number; claimIds: string[] };
    };
    expect(entry.entityType).toBe('Customer');
    expect(entry.isSensitiveDataAccess).toBe(true);
    expect(entry.afterValue.count).toBe(2);
    expect(entry.afterValue.claimIds).toEqual(['claim-a', 'claim-b']);
  });
});

const REGISTER_DTO: RegisterClaimDto = {
  insurerClaimReference: 'INS-CLM-2026-0042',
  adjuster: { name: 'Cunningham Lindsey', firm: 'CL Loss Adjusters' },
};

describe('ClaimService.register', () => {
  it('drives NOTIFIED -> REGISTERED through the engine, persists the insurer ref, and assigns the adjuster', async () => {
    const { service, workflow, claimRepo, audit } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());

    const view = await service.register(
      'claim-1',
      { ...REGISTER_DTO, claimNumber: 'BRK-2026-77' },
      claims(),
    );

    expect(workflow.transition).toHaveBeenCalledOnce();
    const tArg = workflow.transition.mock.calls[0][0] as {
      entityType: string;
      toStatus: string;
      data: Record<string, unknown>;
    };
    expect(tArg.entityType).toBe('Claim');
    expect(tArg.toStatus).toBe('REGISTERED');
    expect(tArg.data).toEqual({
      insurerClaimReference: 'INS-CLM-2026-0042',
      claimNumber: 'BRK-2026-77',
    });

    expect(view.status).toBe('REGISTERED');
    expect(view.insurerClaimReference).toBe('INS-CLM-2026-0042');
    expect(view.claimNumber).toBe('BRK-2026-77');
    expect(view.adjuster).toMatchObject({
      name: 'Cunningham Lindsey',
      firm: 'CL Loss Adjusters',
    });
    expect(view.statusHistory.map((h) => h.toStatus)).toEqual([
      'NOTIFIED',
      'REGISTERED',
    ]);
    expect(claimRepo.recordRegistration).toHaveBeenCalledOnce();

    const adjusterAudit = audit.record.mock.calls.find(
      (c) => (c[0] as { entityType: string }).entityType === 'Adjuster',
    );
    expect(adjusterAudit).toBeDefined();
    const claimUpdate = audit.record.mock.calls.find(
      (c) =>
        (c[0] as { entityType: string; action: string }).entityType ===
          'Claim' && (c[0] as { action: string }).action === 'UPDATE',
    );
    expect(
      (claimUpdate?.[0] as { afterValue: Record<string, unknown> }).afterValue,
    ).toEqual({
      claimId: 'claim-1',
      insurerClaimReference: 'INS-CLM-2026-0042',
      claimNumber: 'BRK-2026-77',
    });
  });

  it('omits the claim number from the transition data when not supplied', async () => {
    const { service, workflow } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    await service.register('claim-1', { ...REGISTER_DTO }, claims());
    const tArg = workflow.transition.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(tArg.data).toEqual({
      insurerClaimReference: 'INS-CLM-2026-0042',
    });
  });

  it('is an idempotent no-op when re-called with the same insurer ref + adjuster', async () => {
    const { service, workflow, claimRepo } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    await service.register('claim-1', { ...REGISTER_DTO }, claims());

    workflow.transition.mockClear();
    claimRepo.recordRegistration.mockClear();
    const view = await service.register(
      'claim-1',
      { ...REGISTER_DTO },
      claims(),
    );

    expect(view.status).toBe('REGISTERED');
    expect(workflow.transition).not.toHaveBeenCalled();
    expect(claimRepo.recordRegistration).not.toHaveBeenCalled();
  });

  it('409s a re-register with a different insurer ref / adjuster', async () => {
    const { service } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    await service.register('claim-1', { ...REGISTER_DTO }, claims());

    await expect(
      service.register(
        'claim-1',
        {
          insurerClaimReference: 'INS-DIFFERENT-999',
          adjuster: { name: 'Someone Else' },
        },
        claims(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s a re-register that only changes the adjuster firm (registration detail is not silently discarded)', async () => {
    const { service } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    await service.register('claim-1', { ...REGISTER_DTO }, claims());

    await expect(
      service.register(
        'claim-1',
        {
          ...REGISTER_DTO,
          adjuster: {
            name: REGISTER_DTO.adjuster.name,
            firm: 'A Different Firm',
          },
        },
        claims(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resumes a partially-completed registration (status REGISTERED, no adjuster) without re-transitioning', async () => {
    const { service, workflow, claimRepo, audit } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    // simulate: the transition committed, the artefact write did not
    claimRepo.findById.mockResolvedValueOnce({
      id: 'claim-1',
      claimNumber: null,
      insurerClaimReference: 'INS-CLM-2026-0042',
      status: 'REGISTERED',
      classification: 'HIGHLY_CONFIDENTIAL',
      followUpAlertThresholdDays: 9,
      customerId: 'cus-1',
      policyId: 'pol-1',
      lossDate: new Date('2026-03-15T00:00:00.000Z'),
      lossLocation: null,
      causeOfLoss: 'x',
      estimatedLoss: new Prisma.Decimal('20000'),
      isThirdPartyInvolved: false,
      isLargeClaim: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      policy: {
        id: 'pol-1',
        customerId: 'cus-1',
        policyNumber: 'POL-1',
        insuranceLine: 'Property All Risks',
        expiryDate: EXPIRY,
        schedules: [
          { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
        ],
      },
      thirdParty: null,
      adjuster: null,
      statusHistory: [
        {
          fromStatus: null,
          toStatus: 'NOTIFIED',
          changedByUserId: 'clm-1',
          changedAt: new Date(),
        },
      ],
    });

    await service.register('claim-1', { ...REGISTER_DTO }, claims());

    expect(workflow.transition).not.toHaveBeenCalled();
    expect(claimRepo.recordRegistration).toHaveBeenCalledOnce();
    // no UPDATE Claim audit on a resume (the scalars were written the first time)
    const claimUpdate = audit.record.mock.calls.find(
      (c) =>
        (c[0] as { entityType: string; action: string }).entityType ===
          'Claim' && (c[0] as { action: string }).action === 'UPDATE',
    );
    expect(claimUpdate).toBeUndefined();
  });

  it('422s registration of a claim that is not NOTIFIED (e.g. already past REGISTERED)', async () => {
    const { service, claimRepo } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    claimRepo.findById.mockResolvedValueOnce({
      id: 'claim-1',
      claimNumber: null,
      insurerClaimReference: null,
      status: 'UNDER_ASSESSMENT',
      classification: 'HIGHLY_CONFIDENTIAL',
      followUpAlertThresholdDays: 9,
      customerId: 'cus-1',
      policyId: 'pol-1',
      lossDate: new Date('2026-03-15T00:00:00.000Z'),
      lossLocation: null,
      causeOfLoss: 'x',
      estimatedLoss: new Prisma.Decimal('20000'),
      isThirdPartyInvolved: false,
      isLargeClaim: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      policy: {
        id: 'pol-1',
        customerId: 'cus-1',
        policyNumber: 'POL-1',
        insuranceLine: 'Property All Risks',
        expiryDate: EXPIRY,
        schedules: [
          { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
        ],
      },
      thirdParty: null,
      adjuster: null,
      statusHistory: [],
      followUpAlerts: [],
      settlement: null,
    });

    await expect(
      service.register('claim-1', { ...REGISTER_DTO }, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('409s a duplicate broker claim number (P2002 from the engine)', async () => {
    const { service, workflow } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    workflow.transition.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.register(
        'claim-1',
        { ...REGISTER_DTO, claimNumber: 'TAKEN-1' },
        claims(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s registration by a caller who cannot see the claim', async () => {
    const { service } = makeDeps({ customerOwner: 'someone-else' });
    await expect(
      service.register('claim-1', { ...REGISTER_DTO }, sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('normalises a lost NOTIFIED -> REGISTERED race (engine "already in status") to the already-registered path', async () => {
    const { service, claimRepo, workflow } = makeDeps();
    await service.notify({ ...BASE_DTO }, claims());
    // a concurrent register won: the engine's pre-read already saw REGISTERED
    workflow.transition.mockRejectedValueOnce(
      new UnprocessableEntityException(
        'Claim claim-1: already in status REGISTERED',
      ),
    );
    // ...and it fully registered the claim with a DIFFERENT adjuster
    claimRepo.findById.mockResolvedValueOnce({
      id: 'claim-1',
      claimNumber: null,
      insurerClaimReference: 'INS-CONCURRENT-1',
      status: 'REGISTERED',
      classification: 'HIGHLY_CONFIDENTIAL',
      followUpAlertThresholdDays: 9,
      customerId: 'cus-1',
      policyId: 'pol-1',
      lossDate: new Date('2026-03-15T00:00:00.000Z'),
      lossLocation: null,
      causeOfLoss: 'x',
      estimatedLoss: new Prisma.Decimal('20000'),
      isThirdPartyInvolved: false,
      isLargeClaim: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      policy: {
        id: 'pol-1',
        customerId: 'cus-1',
        policyNumber: 'POL-1',
        insuranceLine: 'Property All Risks',
        expiryDate: EXPIRY,
        schedules: [
          { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
        ],
      },
      thirdParty: null,
      adjuster: {
        name: 'The Other Adjuster',
        firm: null,
        assignedAt: new Date(),
        surveyCompletedAt: null,
        investigationCompletedAt: null,
      },
      statusHistory: [],
      followUpAlerts: [],
      settlement: null,
    });

    await expect(
      service.register('claim-1', { ...REGISTER_DTO }, claims()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(claimRepo.recordRegistration).not.toHaveBeenCalled();
  });
});

describe('ClaimService.attachDocuments', () => {
  const PHOTO = {
    docType: 'photo' as const,
    classification: 'CONFIDENTIAL' as const,
    fileName: 'site-1.jpg',
    storageRef: 's3://claims/site-1.jpg',
  };

  async function registeredClaim() {
    const deps = makeDeps({ policyMissing: false });
    await deps.service.notify({ ...BASE_DTO }, claims());
    await deps.service.register('claim-1', { ...REGISTER_DTO }, claims());
    deps.workflow.transition.mockClear();
    return deps;
  }

  it('files the documents, audits each ClaimDocument (no fileName/storageRef), and best-effort advances REGISTERED -> DOCUMENTATION_IN_PROGRESS', async () => {
    const { service, claimRepo, workflow, audit } = await registeredClaim();

    const view = await service.attachDocuments(
      'claim-1',
      { documents: [{ ...PHOTO }, { ...PHOTO, docType: 'claim_form' }] },
      claims(),
    );

    expect(claimRepo.attachDocuments).toHaveBeenCalledOnce();
    expect(view.documents.map((d) => d.docType)).toEqual([
      'photo',
      'claim_form',
    ]);
    expect(view.status).toBe('DOCUMENTATION_IN_PROGRESS');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Claim',
        toStatus: 'DOCUMENTATION_IN_PROGRESS',
      }),
    );
    expect(view.statusHistory.map((h) => h.toStatus)).toContain(
      'DOCUMENTATION_IN_PROGRESS',
    );

    const docAudits = audit.record.mock.calls.filter(
      (c) => (c[0] as { entityType: string }).entityType === 'ClaimDocument',
    );
    expect(docAudits).toHaveLength(2);
    expect(JSON.stringify(docAudits)).not.toContain('site-1.jpg');
    expect(JSON.stringify(docAudits)).not.toContain('s3://');
  });

  it('computes the mandatory checklist per claim type (property line here) and documentationComplete', async () => {
    const { service } = await registeredClaim();
    // property line (BASE_DTO policy) -> mandatory: claim_form, photo, repair_estimate
    let view = await service.attachDocuments(
      'claim-1',
      {
        documents: [
          { ...PHOTO, docType: 'claim_form', fileName: 'form.pdf' },
          { ...PHOTO },
        ],
      },
      claims(),
    );
    expect(view.missingMandatoryDocuments).toEqual(['repair_estimate']);
    expect(view.documentationComplete).toBe(false);

    view = await service.attachDocuments(
      'claim-1',
      {
        documents: [
          { ...PHOTO, docType: 'repair_estimate', fileName: 'quote.pdf' },
        ],
      },
      claims(),
    );
    expect(view.missingMandatoryDocuments).toEqual([]);
    expect(view.documentationComplete).toBe(true);
  });

  it('422s a medical_report that is not HIGHLY_CONFIDENTIAL', async () => {
    const { service, claimRepo } = await registeredClaim();
    await expect(
      service.attachDocuments(
        'claim-1',
        {
          documents: [
            {
              ...PHOTO,
              docType: 'medical_report',
              classification: 'CONFIDENTIAL',
            },
          ],
        },
        claims(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(claimRepo.attachDocuments).not.toHaveBeenCalled();
  });

  it('accepts a HIGHLY_CONFIDENTIAL medical_report', async () => {
    const { service } = await registeredClaim();
    const view = await service.attachDocuments(
      'claim-1',
      {
        documents: [
          {
            ...PHOTO,
            docType: 'medical_report',
            classification: 'HIGHLY_CONFIDENTIAL',
          },
        ],
      },
      claims(),
    );
    expect(view.documents[0].docType).toBe('medical_report');
    expect(view.documents[0].classification).toBe('HIGHLY_CONFIDENTIAL');
  });

  it('422s an attach while the claim is still NOTIFIED (register first)', async () => {
    const deps = makeDeps();
    await deps.service.notify({ ...BASE_DTO }, claims());
    await expect(
      deps.service.attachDocuments(
        'claim-1',
        { documents: [{ ...PHOTO }] },
        claims(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.claimRepo.attachDocuments).not.toHaveBeenCalled();
  });

  it('does not re-transition on a later attach (already DOCUMENTATION_IN_PROGRESS)', async () => {
    const { service, workflow } = await registeredClaim();
    await service.attachDocuments(
      'claim-1',
      { documents: [{ ...PHOTO }] },
      claims(),
    );
    workflow.transition.mockClear();
    await service.attachDocuments(
      'claim-1',
      { documents: [{ ...PHOTO, docType: 'invoice', fileName: 'inv.pdf' }] },
      claims(),
    );
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('still files the documents if the best-effort advance throws (logged, not thrown)', async () => {
    const { service, workflow } = await registeredClaim();
    workflow.transition.mockRejectedValueOnce(new Error('engine down'));
    const view = await service.attachDocuments(
      'claim-1',
      { documents: [{ ...PHOTO }] },
      claims(),
    );
    expect(view.documents).toHaveLength(1);
    // status stayed REGISTERED (the advance failed) but the docs are filed
    expect(view.status).toBe('REGISTERED');
  });

  it('404s an attach by a caller who cannot see the claim', async () => {
    // Claims Officer (cross-owner) sets the claim up; a Sales officer who does
    // NOT own the customer cannot see it.
    const { service } = makeDeps({ customerOwner: 'someone-else' });
    await service.notify({ ...BASE_DTO }, claims());
    await service.register('claim-1', { ...REGISTER_DTO }, claims());
    await expect(
      service.attachDocuments(
        'claim-1',
        { documents: [{ ...PHOTO }] },
        sales(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('backfills the DOCUMENTATION_IN_PROGRESS history row on a later attach when the first attach transitioned but its history write threw', async () => {
    const { service, claimRepo, workflow } = await registeredClaim();

    // First attach: the engine transition commits (status -> DIP) but the
    // separate domain history write fails.
    claimRepo.recordStatusHistory.mockRejectedValueOnce(
      new Error('history write failed'),
    );
    let view = await service.attachDocuments(
      'claim-1',
      { documents: [{ ...PHOTO }] },
      claims(),
    );
    expect(view.status).toBe('DOCUMENTATION_IN_PROGRESS');
    expect(view.documents).toHaveLength(1);
    // the history row did NOT land
    expect(view.statusHistory.map((h) => h.toStatus)).not.toContain(
      'DOCUMENTATION_IN_PROGRESS',
    );

    workflow.transition.mockClear();
    claimRepo.recordStatusHistory.mockClear();

    // Second attach: status is already DIP so no re-transition, but the missing
    // history row is backfilled (needsAdvance keys off the row being absent).
    view = await service.attachDocuments(
      'claim-1',
      {
        documents: [
          { ...PHOTO, docType: 'repair_estimate', fileName: 'q.pdf' },
        ],
      },
      claims(),
    );
    expect(workflow.transition).not.toHaveBeenCalled();
    expect(claimRepo.recordStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'DOCUMENTATION_IN_PROGRESS' }),
    );
    expect(view.statusHistory.map((h) => h.toStatus)).toEqual([
      'NOTIFIED',
      'REGISTERED',
      'DOCUMENTATION_IN_PROGRESS',
    ]);
  });

  it('records a sensitive-data-access READ audit on the attach (ids only, no fileName / claim content)', async () => {
    const { service, audit } = await registeredClaim();
    audit.record.mockClear();

    await service.attachDocuments(
      'claim-1',
      { documents: [{ ...PHOTO }] },
      claims(),
    );

    const read = audit.record.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'READ',
    );
    expect(read).toBeDefined();
    const entry = read?.[0] as {
      entityType: string;
      isSensitiveDataAccess: boolean;
      afterValue: Record<string, unknown>;
    };
    expect(entry.entityType).toBe('Claim');
    expect(entry.isSensitiveDataAccess).toBe(true);
    expect(entry.afterValue).toEqual({
      view: 'claim-attach-documents',
      claimId: 'claim-1',
      documentsFiled: 1,
    });
    expect(JSON.stringify(entry.afterValue)).not.toContain('site-1.jpg');
  });
});

describe('ClaimService assessment (Process 26)', () => {
  const SURVEY_AT = '2026-04-01T00:00:00.000Z'; // after BASE_DTO lossDate, past
  const INVESTIGATION_AT = '2026-04-05T00:00:00.000Z';

  const DOC = (
    docType: ClaimDocType,
    fileName: string,
  ): {
    docType: ClaimDocType;
    classification: 'CONFIDENTIAL';
    fileName: string;
    storageRef: string;
  } => ({
    docType,
    classification: 'CONFIDENTIAL',
    fileName,
    storageRef: `s3://${fileName}`,
  });

  /** notify -> register -> attach every mandatory doc (property line:
   * claim_form + photo + repair_estimate) so `documentationComplete` is true.
   * `withAdjusterWork` also stamps the survey + investigation. */
  async function documentedClaim(withAdjusterWork = false) {
    const deps = makeDeps();
    await deps.service.notify({ ...BASE_DTO }, claims());
    await deps.service.register('claim-1', { ...REGISTER_DTO }, claims());
    await deps.service.attachDocuments(
      'claim-1',
      {
        documents: [
          DOC('claim_form', 'cf.pdf'),
          DOC('photo', 'ph.jpg'),
          DOC('repair_estimate', 're.pdf'),
        ],
      },
      claims(),
    );
    if (withAdjusterWork) {
      await deps.service.recordAdjusterProgress(
        'claim-1',
        {
          surveyCompletedAt: SURVEY_AT,
          investigationCompletedAt: INVESTIGATION_AT,
        },
        claims(),
      );
    }
    deps.workflow.transition.mockClear();
    deps.audit.record.mockClear();
    return deps;
  }

  describe('recordAdjusterProgress', () => {
    it('stamps survey + investigation and surfaces them on the view', async () => {
      const { service } = await documentedClaim();
      const view = await service.recordAdjusterProgress(
        'claim-1',
        {
          surveyCompletedAt: SURVEY_AT,
          investigationCompletedAt: INVESTIGATION_AT,
        },
        claims(),
      );
      expect(view.assessment.surveyCompletedAt).toEqual(new Date(SURVEY_AT));
      expect(view.assessment.investigationCompletedAt).toEqual(
        new Date(INVESTIGATION_AT),
      );
      expect(view.assessment.adjusterWorkComplete).toBe(true);
      expect(view.adjuster?.surveyCompletedAt).toEqual(new Date(SURVEY_AT));
    });

    it('is a no-op when re-sent with the identical value, a 409 on a different one', async () => {
      const { service } = await documentedClaim();
      await service.recordAdjusterProgress(
        'claim-1',
        { surveyCompletedAt: SURVEY_AT },
        claims(),
      );
      // identical -> fine
      await service.recordAdjusterProgress(
        'claim-1',
        { surveyCompletedAt: SURVEY_AT },
        claims(),
      );
      // different -> 409
      await expect(
        service.recordAdjusterProgress(
          'claim-1',
          { surveyCompletedAt: '2026-04-02T00:00:00.000Z' },
          claims(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('422 when neither timestamp is provided', async () => {
      const { service } = await documentedClaim();
      await expect(
        service.recordAdjusterProgress('claim-1', {}, claims()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when a completion instant predates the loss date', async () => {
      const { service } = await documentedClaim();
      await expect(
        service.recordAdjusterProgress(
          'claim-1',
          { surveyCompletedAt: '2026-01-01T00:00:00.000Z' },
          claims(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when the claim has no adjuster yet (still NOTIFIED)', async () => {
      const { service } = makeDeps();
      await service.notify({ ...BASE_DTO }, claims());
      await expect(
        service.recordAdjusterProgress(
          'claim-1',
          { surveyCompletedAt: SURVEY_AT },
          claims(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('records an UPDATE Adjuster audit (ids + timestamps, no narrative) and a sensitive READ', async () => {
      const { service, audit } = await documentedClaim();
      await service.recordAdjusterProgress(
        'claim-1',
        { surveyCompletedAt: SURVEY_AT },
        claims(),
      );
      const upd = audit.record.mock.calls.find(
        (c) =>
          (c[0] as { entityType: string; action: string }).entityType ===
            'Adjuster' && (c[0] as { action: string }).action === 'UPDATE',
      );
      expect(upd).toBeDefined();
      expect(
        (upd?.[0] as { afterValue: Record<string, unknown> }).afterValue,
      ).toMatchObject({ surveyCompletedAt: SURVEY_AT });
      const read = audit.record.mock.calls.find(
        (c) => (c[0] as { action: string }).action === 'READ',
      );
      expect(
        (read?.[0] as { isSensitiveDataAccess: boolean }).isSensitiveDataAccess,
      ).toBe(true);
    });
  });

  describe('submitForAssessment', () => {
    it('422 while the mandatory documentation is incomplete', async () => {
      const deps = makeDeps();
      await deps.service.notify({ ...BASE_DTO }, claims());
      await deps.service.register('claim-1', { ...REGISTER_DTO }, claims());
      await deps.service.attachDocuments(
        'claim-1',
        { documents: [DOC('claim_form', 'cf.pdf')] }, // photo + repair_estimate missing
        claims(),
      );
      await expect(
        deps.service.submitForAssessment('claim-1', claims()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('drives DOCUMENTATION_IN_PROGRESS -> UNDER_ASSESSMENT through the engine + writes the history row', async () => {
      const { service, workflow, claimRepo } = await documentedClaim();
      const view = await service.submitForAssessment('claim-1', claims());
      expect(view.status).toBe('UNDER_ASSESSMENT');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Claim',
          toStatus: 'UNDER_ASSESSMENT',
        }),
      );
      expect(claimRepo.recordStatusHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: 'DOCUMENTATION_IN_PROGRESS',
          toStatus: 'UNDER_ASSESSMENT',
        }),
      );
      expect(view.statusHistory.map((h) => h.toStatus)).toEqual([
        'NOTIFIED',
        'REGISTERED',
        'DOCUMENTATION_IN_PROGRESS',
        'UNDER_ASSESSMENT',
      ]);
    });

    it('is idempotent once UNDER_ASSESSMENT — no re-transition', async () => {
      const { service, workflow } = await documentedClaim();
      await service.submitForAssessment('claim-1', claims());
      workflow.transition.mockClear();
      const view = await service.submitForAssessment('claim-1', claims());
      expect(workflow.transition).not.toHaveBeenCalled();
      expect(view.status).toBe('UNDER_ASSESSMENT');
    });

    it('backfills a missing UNDER_ASSESSMENT history row on a re-call without re-transitioning', async () => {
      const { service, workflow, claimRepo } = await documentedClaim();
      // first submit: the engine transition commits but the history write throws
      claimRepo.recordStatusHistory.mockRejectedValueOnce(
        new Error('history write failed'),
      );
      let view = await service.submitForAssessment('claim-1', claims());
      expect(view.status).toBe('UNDER_ASSESSMENT');
      expect(view.statusHistory.map((h) => h.toStatus)).not.toContain(
        'UNDER_ASSESSMENT',
      );
      workflow.transition.mockClear();
      claimRepo.recordStatusHistory.mockClear();
      view = await service.submitForAssessment('claim-1', claims());
      expect(workflow.transition).not.toHaveBeenCalled();
      expect(claimRepo.recordStatusHistory).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'UNDER_ASSESSMENT' }),
      );
      expect(view.statusHistory.map((h) => h.toStatus)).toContain(
        'UNDER_ASSESSMENT',
      );
    });

    it('422 when the claim is not yet DOCUMENTATION_IN_PROGRESS', async () => {
      const deps = makeDeps();
      await deps.service.notify({ ...BASE_DTO }, claims());
      await deps.service.register('claim-1', { ...REGISTER_DTO }, claims());
      await expect(
        deps.service.submitForAssessment('claim-1', claims()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('decideAssessment', () => {
    async function underAssessment(withAdjusterWork = true) {
      const deps = await documentedClaim(withAdjusterWork);
      await deps.service.submitForAssessment('claim-1', claims());
      deps.workflow.transition.mockClear();
      return deps;
    }

    it('422 before the claim has been submitted for assessment', async () => {
      const { service } = await documentedClaim(true);
      await expect(
        service.decideAssessment('claim-1', { outcome: 'APPROVED' }, claims()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when the loss adjuster has not completed survey + investigation', async () => {
      const { service } = await underAssessment(false);
      await expect(
        service.decideAssessment('claim-1', { outcome: 'APPROVED' }, claims()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it.each(['APPROVED', 'PARTIALLY_APPROVED', 'DECLINED'] as const)(
      'drives UNDER_ASSESSMENT -> %s through the engine + writes the history row',
      async (outcome) => {
        const { service, workflow, claimRepo } = await underAssessment();
        const view = await service.decideAssessment(
          'claim-1',
          { outcome },
          claims(),
        );
        expect(view.status).toBe(outcome);
        expect(view.assessment.outcome).toBe(outcome);
        expect(workflow.transition).toHaveBeenCalledWith(
          expect.objectContaining({ entityType: 'Claim', toStatus: outcome }),
        );
        expect(claimRepo.recordStatusHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            fromStatus: 'UNDER_ASSESSMENT',
            toStatus: outcome,
          }),
        );
      },
    );

    it('is idempotent when re-sent with the recorded verdict, a 409 on a different one', async () => {
      const { service, workflow } = await underAssessment();
      await service.decideAssessment(
        'claim-1',
        { outcome: 'PARTIALLY_APPROVED' },
        claims(),
      );
      workflow.transition.mockClear();
      // identical -> no-op
      const again = await service.decideAssessment(
        'claim-1',
        { outcome: 'PARTIALLY_APPROVED' },
        claims(),
      );
      expect(again.status).toBe('PARTIALLY_APPROVED');
      expect(workflow.transition).not.toHaveBeenCalled();
      // different -> 409
      await expect(
        service.decideAssessment('claim-1', { outcome: 'DECLINED' }, claims()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('backfills a missing UNDER_ASSESSMENT trail row when submit transitioned but its history write threw (review MINOR 1)', async () => {
      const { service, claimRepo } = await documentedClaim(true);
      // submit: the engine transition commits, the domain history write fails
      claimRepo.recordStatusHistory.mockRejectedValueOnce(
        new Error('history write failed'),
      );
      const submitted = await service.submitForAssessment('claim-1', claims());
      expect(submitted.status).toBe('UNDER_ASSESSMENT');
      expect(submitted.statusHistory.map((h) => h.toStatus)).not.toContain(
        'UNDER_ASSESSMENT',
      );
      // straight to the verdict without re-calling submit — the intermediate
      // row is reconciled, not permanently lost
      const decided = await service.decideAssessment(
        'claim-1',
        { outcome: 'APPROVED' },
        claims(),
      );
      expect(decided.statusHistory.map((h) => h.toStatus)).toEqual([
        'NOTIFIED',
        'REGISTERED',
        'DOCUMENTATION_IN_PROGRESS',
        'UNDER_ASSESSMENT',
        'APPROVED',
      ]);
    });

    it('normalises a lost UNDER_ASSESSMENT -> verdict race to a clean 409, not the engine raw error (review MINOR 1)', async () => {
      const { service, workflow, claimRepo } = await underAssessment();
      const rowAt = (status: string) => ({
        id: 'claim-1',
        claimNumber: null,
        status,
        classification: 'HIGHLY_CONFIDENTIAL',
        followUpAlertThresholdDays: 9,
        customerId: 'cus-1',
        policyId: 'pol-1',
        lossDate: new Date('2026-03-15T00:00:00.000Z'),
        lossLocation: null,
        causeOfLoss: 'x',
        estimatedLoss: new Prisma.Decimal('20000'),
        isThirdPartyInvolved: false,
        isLargeClaim: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        policy: {
          id: 'pol-1',
          customerId: 'cus-1',
          policyNumber: 'POL-1',
          insuranceLine: 'Property All Risks',
          expiryDate: EXPIRY,
          schedules: [
            { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
          ],
        },
        thirdParty: null,
        adjuster: {
          name: 'A',
          firm: null,
          assignedAt: new Date(),
          surveyCompletedAt: new Date('2026-04-01T00:00:00.000Z'),
          investigationCompletedAt: new Date('2026-04-05T00:00:00.000Z'),
        },
        documents: [],
        statusHistory: [{ toStatus: status }],
        followUpAlerts: [],
        settlement: null,
      });
      // call #1 (gate check) still sees UNDER_ASSESSMENT; our engine transition
      // then loses the race; the catch-block reload (#2) sees a concurrent
      // caller's DIFFERENT verdict.
      claimRepo.findById
        .mockImplementationOnce(() =>
          Promise.resolve(rowAt('UNDER_ASSESSMENT')),
        )
        .mockImplementationOnce(() => Promise.resolve(rowAt('DECLINED')));
      workflow.transition.mockRejectedValueOnce(
        new ConflictException('status changed concurrently'),
      );
      await expect(
        service.decideAssessment('claim-1', { outcome: 'APPROVED' }, claims()),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('recordAdjusterProgress — concurrent write (review MINOR 2)', () => {
    it('409s a caller whose stamp lost the race to a different concurrent value', async () => {
      const { service, claimRepo } = await documentedClaim();
      // the repo reports it wrote NOTHING and the row already holds a
      // different value — a concurrent caller stamped it first
      claimRepo.recordAdjusterProgress.mockImplementationOnce(() =>
        Promise.resolve({
          adjuster: {
            id: 'adj-1',
            surveyCompletedAt: new Date('2026-04-09T00:00:00.000Z'),
            investigationCompletedAt: null,
          },
          wrote: { surveyCompletedAt: false, investigationCompletedAt: false },
        }),
      );
      await expect(
        service.recordAdjusterProgress(
          'claim-1',
          { surveyCompletedAt: '2026-04-01T00:00:00.000Z' },
          claims(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('is a no-op (not a 409) when the concurrent value matches ours', async () => {
      const { service, claimRepo } = await documentedClaim();
      claimRepo.recordAdjusterProgress.mockImplementationOnce(() =>
        Promise.resolve({
          adjuster: {
            id: 'adj-1',
            surveyCompletedAt: new Date('2026-04-01T00:00:00.000Z'),
            investigationCompletedAt: null,
          },
          wrote: { surveyCompletedAt: false, investigationCompletedAt: false },
        }),
      );
      await expect(
        service.recordAdjusterProgress(
          'claim-1',
          { surveyCompletedAt: '2026-04-01T00:00:00.000Z' },
          claims(),
        ),
      ).resolves.toBeDefined();
    });
  });

  it('404s every assessment endpoint for a caller who cannot see the claim', async () => {
    const { service } = makeDeps({ customerOwner: 'someone-else' });
    await service.notify({ ...BASE_DTO }, claims());
    await service.register('claim-1', { ...REGISTER_DTO }, claims());
    await expect(
      service.recordAdjusterProgress(
        'claim-1',
        { surveyCompletedAt: SURVEY_AT },
        sales(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.submitForAssessment('claim-1', sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.decideAssessment('claim-1', { outcome: 'APPROVED' }, sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClaimService follow-up (Process 27)', () => {
  const REGISTERED_LONG_AGO = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const REGISTERED_RECENTLY = new Date(Date.now() - 60 * 1000);

  /** a bare pre-verdict claim row for the sweep's candidate list */
  const awaitingRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'claim-1',
    status: 'UNDER_ASSESSMENT',
    followUpAlertThresholdDays: 9,
    createdAt: REGISTERED_LONG_AGO,
    statusHistory: [
      { toStatus: 'NOTIFIED', changedAt: REGISTERED_LONG_AGO },
      { toStatus: 'REGISTERED', changedAt: REGISTERED_LONG_AGO },
    ],
    followUpAlerts: [] as { id: string }[],
    ...over,
  });

  describe('runFollowUpScan', () => {
    it('raises an alert for a due claim with none open, and audits it', async () => {
      const { service, claimRepo, audit } = makeDeps();
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue([
        awaitingRow(),
      ]);

      const result = await service.runFollowUpScan('system-1');

      expect(result).toMatchObject({ awaiting: 1, due: 1, raised: 1 });
      expect(claimRepo.raiseFollowUpAlert).toHaveBeenCalledWith(
        'claim-1',
        expect.any(Date),
      );
      const created = audit.record.mock.calls.find(
        (c) =>
          (c[0] as { entityType: string }).entityType === 'ClaimFollowUpAlert',
      );
      expect(created).toBeDefined();
      expect(
        (
          created?.[0] as {
            action: string;
            afterValue: Record<string, unknown>;
          }
        ).action,
      ).toBe('CREATE');
      expect(
        (created?.[0] as { afterValue: Record<string, unknown> }).afterValue,
      ).toMatchObject({ claimId: 'claim-1', thresholdDays: 9 });
    });

    it('falls back to the claim earliest instant (+ a warn) when the REGISTERED history row is missing (review MINOR)', async () => {
      const { service, claimRepo } = makeDeps();
      const warn = vi
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue([
        awaitingRow({
          statusHistory: [
            { toStatus: 'NOTIFIED', changedAt: REGISTERED_LONG_AGO },
          ],
        }),
      ]);

      const result = await service.runFollowUpScan('system-1');

      // still chased (the fallback clock is old enough) + ops was warned
      expect(result).toMatchObject({ due: 1, raised: 1 });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no REGISTERED ClaimStatusHistory row'),
      );
    });

    it('warns when the candidate set hits FOLLOWUP_SWEEP_LIMIT (review MINOR)', async () => {
      const { service, claimRepo } = makeDeps();
      const warn = vi
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue(
        Array.from({ length: ClaimRepository.FOLLOWUP_SWEEP_LIMIT }, (_, i) =>
          awaitingRow({ id: `c-${i}`, followUpAlerts: [{ id: 'x' }] }),
        ),
      );

      await service.runFollowUpScan('system-1');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('row cap'));
    });

    it('does not raise for a claim still within its threshold', async () => {
      const { service, claimRepo } = makeDeps();
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue([
        awaitingRow({
          statusHistory: [
            { toStatus: 'REGISTERED', changedAt: REGISTERED_RECENTLY },
          ],
        }),
      ]);

      const result = await service.runFollowUpScan('system-1');

      expect(result).toMatchObject({ due: 0, raised: 0 });
      expect(claimRepo.raiseFollowUpAlert).not.toHaveBeenCalled();
    });

    it('skips a due claim that already has an open alert', async () => {
      const { service, claimRepo } = makeDeps();
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue([
        awaitingRow({ followUpAlerts: [{ id: 'fa-existing' }] }),
      ]);

      const result = await service.runFollowUpScan('system-1');

      expect(result).toMatchObject({
        due: 1,
        raised: 0,
        skippedAlreadyAlerted: 1,
      });
      expect(claimRepo.raiseFollowUpAlert).not.toHaveBeenCalled();
    });

    it('counts a P2002 loss (concurrent sweep) as skippedAlreadyAlerted, not failed', async () => {
      const { service, claimRepo } = makeDeps();
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue([
        awaitingRow(),
      ]);
      claimRepo.raiseFollowUpAlert.mockResolvedValue({
        created: false,
        alert: null,
      });

      const result = await service.runFollowUpScan('system-1');

      expect(result).toMatchObject({
        raised: 0,
        skippedAlreadyAlerted: 1,
        failed: 0,
      });
    });

    it('auto-resolves an open alert whose claim has progressed past the pre-verdict stage', async () => {
      const { service, claimRepo, audit } = makeDeps();
      claimRepo.findOpenFollowUpAlertsForRespondedClaims.mockResolvedValue([
        {
          id: 'fa-1',
          claimId: 'claim-1',
          triggeredAt: REGISTERED_LONG_AGO,
          resolvedAt: null,
          claim: { id: 'claim-1', status: 'APPROVED' },
        },
      ]);

      const result = await service.runFollowUpScan('system-1');

      expect(result).toMatchObject({ autoResolved: 1 });
      expect(claimRepo.resolveFollowUpAlert).toHaveBeenCalledWith(
        'fa-1',
        expect.any(Date),
      );
      const upd = audit.record.mock.calls.find(
        (c) =>
          (c[0] as { entityType: string }).entityType === 'ClaimFollowUpAlert',
      );
      expect(
        (upd?.[0] as { action: string; afterValue: Record<string, unknown> })
          .action,
      ).toBe('UPDATE');
      expect(
        (upd?.[0] as { afterValue: Record<string, unknown> }).afterValue,
      ).toMatchObject({ resolvedBy: 'sweep' });
    });

    it('per-row isolation: one row that throws does not abandon the rest', async () => {
      const { service, claimRepo } = makeDeps();
      claimRepo.findClaimsAwaitingInsurerResponse.mockResolvedValue([
        awaitingRow({ id: 'bad' }),
        awaitingRow({ id: 'good' }),
      ]);
      claimRepo.raiseFollowUpAlert.mockImplementation((claimId: string) => {
        if (claimId === 'bad') return Promise.reject(new Error('db blip'));
        return Promise.resolve({
          created: true,
          alert: {
            id: 'fa-good',
            claimId,
            triggeredAt: new Date(),
            resolvedAt: null,
          },
        });
      });

      const result = await service.runFollowUpScan('system-1');

      expect(result).toMatchObject({ raised: 1, failed: 1 });
    });
  });

  describe('resolveFollowUpAlert', () => {
    async function claimWithOpenAlert() {
      const deps = makeDeps();
      await deps.service.notify({ ...BASE_DTO }, claims());
      const alert = { id: 'fa-1', triggeredAt: new Date(), resolvedAt: null };
      deps.claimRepo.findById.mockImplementation(() =>
        Promise.resolve({
          id: 'claim-1',
          claimNumber: null,
          status: 'UNDER_ASSESSMENT',
          classification: 'HIGHLY_CONFIDENTIAL',
          followUpAlertThresholdDays: 9,
          customerId: 'cus-1',
          policyId: 'pol-1',
          lossDate: new Date('2026-03-15T00:00:00.000Z'),
          lossLocation: null,
          causeOfLoss: 'x',
          estimatedLoss: new Prisma.Decimal('20000'),
          isThirdPartyInvolved: false,
          isLargeClaim: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          policy: {
            id: 'pol-1',
            customerId: 'cus-1',
            policyNumber: 'POL-1',
            insuranceLine: 'Property All Risks',
            expiryDate: EXPIRY,
            schedules: [
              { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
            ],
          },
          thirdParty: null,
          adjuster: null,
          documents: [],
          followUpAlerts: [alert],
          statusHistory: [{ toStatus: 'REGISTERED', changedAt: new Date() }],
        }),
      );
      return deps;
    }

    it('resolves an open alert and audits it (resolvedBy: manual)', async () => {
      const { service, claimRepo, audit } = await claimWithOpenAlert();
      audit.record.mockClear();

      await service.resolveFollowUpAlert('claim-1', 'fa-1', claims());

      expect(claimRepo.resolveFollowUpAlert).toHaveBeenCalledWith(
        'fa-1',
        expect.any(Date),
      );
      const upd = audit.record.mock.calls.find(
        (c) =>
          (c[0] as { entityType: string }).entityType === 'ClaimFollowUpAlert',
      );
      expect(
        (upd?.[0] as { afterValue: Record<string, unknown> }).afterValue,
      ).toMatchObject({ resolvedBy: 'manual', claimId: 'claim-1' });
    });

    it('404s an alert id that is not on this claim', async () => {
      const { service } = await claimWithOpenAlert();
      await expect(
        service.resolveFollowUpAlert('claim-1', 'fa-other', claims()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is an idempotent no-op when the alert is already resolved', async () => {
      const { service, claimRepo } = await claimWithOpenAlert();
      claimRepo.findById.mockImplementation(() =>
        Promise.resolve({
          id: 'claim-1',
          claimNumber: null,
          status: 'UNDER_ASSESSMENT',
          classification: 'HIGHLY_CONFIDENTIAL',
          followUpAlertThresholdDays: 9,
          customerId: 'cus-1',
          policyId: 'pol-1',
          lossDate: new Date('2026-03-15T00:00:00.000Z'),
          lossLocation: null,
          causeOfLoss: 'x',
          estimatedLoss: new Prisma.Decimal('20000'),
          isThirdPartyInvolved: false,
          isLargeClaim: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          policy: {
            id: 'pol-1',
            customerId: 'cus-1',
            policyNumber: 'POL-1',
            insuranceLine: 'Property All Risks',
            expiryDate: EXPIRY,
            schedules: [
              { id: 'sched-v1', effectiveFrom: INCEPTION, effectiveTo: null },
            ],
          },
          thirdParty: null,
          adjuster: null,
          documents: [],
          followUpAlerts: [
            { id: 'fa-1', triggeredAt: new Date(), resolvedAt: new Date() },
          ],
          statusHistory: [{ toStatus: 'REGISTERED', changedAt: new Date() }],
        }),
      );

      await service.resolveFollowUpAlert('claim-1', 'fa-1', claims());
      expect(claimRepo.resolveFollowUpAlert).not.toHaveBeenCalled();
    });

    it('404s a caller who cannot see the claim', async () => {
      const { service } = makeDeps({ customerOwner: 'someone-else' });
      await service.notify({ ...BASE_DTO }, claims());
      await expect(
        service.resolveFollowUpAlert('claim-1', 'fa-1', sales()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('ClaimService settlement (Process 28)', () => {
  /** notify a claim then poke it to a settleable verdict status. */
  async function settleableClaim(status = 'APPROVED') {
    const deps = makeDeps();
    await deps.service.notify({ ...BASE_DTO }, claims()); // estimatedLoss 20000
    deps.claimState.status = status;
    deps.workflow.transition.mockClear();
    deps.audit.record.mockClear();
    return deps;
  }

  const manager = (id = 'mgr-1') =>
    claims({ id, roles: ['BRANCH_DEPARTMENT_MANAGER'] });

  describe('recordSettlement', () => {
    it('records the four figures, computes net, and settles straight through when no second approver is needed', async () => {
      const { service, claimRepo, workflow, audit } = await settleableClaim();

      const view = await service.recordSettlement(
        'claim-1',
        { approvedAmount: '17500.000', deductible: '2500.000' },
        claims(),
      );

      expect(claimRepo.createSettlement).toHaveBeenCalledWith(
        expect.objectContaining({ approvedByUserId: 'clm-1' }),
      );
      const arg = claimRepo.createSettlement.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect((arg.netSettlement as { toString(): string }).toString()).toBe(
        '15000',
      );
      expect(view.settlement).toMatchObject({
        estimatedLoss: '20000.000',
        approvedAmount: '17500.000',
        deductible: '2500.000',
        netSettlement: '15000.000',
        secondApproverRequired: false,
        approvedByUserId: 'clm-1',
      });
      expect(view.status).toBe('SETTLED');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'Claim', toStatus: 'SETTLED' }),
      );
      const created = audit.record.mock.calls.find(
        (c) => (c[0] as { entityType: string }).entityType === 'Settlement',
      );
      expect((created?.[0] as { action: string }).action).toBe('CREATE');
      expect(
        (created?.[0] as { afterValue: Record<string, unknown> }).afterValue,
      ).toMatchObject({
        approvedAmount: '17500.000',
        netSettlement: '15000.000',
      });
    });

    it('a broker-processed payment blocks the straight-through settle (mandatory second approver)', async () => {
      const { service, workflow } = await settleableClaim();

      const view = await service.recordSettlement(
        'claim-1',
        {
          approvedAmount: '500.000',
          deductible: '0.000',
          brokerProcessedPayment: true,
        },
        claims(),
      );

      expect(view.status).toBe('APPROVED'); // NOT settled
      expect(view.settlement?.secondApproverRequired).toBe(true);
      expect(view.settlement?.secondApproverUserId).toBeNull();
      expect(workflow.transition).not.toHaveBeenCalled();
    });

    it('422 when the claim is not APPROVED / PARTIALLY_APPROVED', async () => {
      const { service } = await settleableClaim('UNDER_ASSESSMENT');
      await expect(
        service.recordSettlement(
          'claim-1',
          { approvedAmount: '100.000', deductible: '0.000' },
          claims(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when the approved amount exceeds the estimated loss', async () => {
      const { service } = await settleableClaim();
      await expect(
        service.recordSettlement(
          'claim-1',
          { approvedAmount: '25000.000', deductible: '0.000' }, // > 20000
          claims(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when the deductible exceeds the approved amount (net would be negative)', async () => {
      const { service } = await settleableClaim();
      await expect(
        service.recordSettlement(
          'claim-1',
          { approvedAmount: '5000.000', deductible: '6000.000' },
          claims(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('422 when the approved amount is zero', async () => {
      const { service } = await settleableClaim();
      await expect(
        service.recordSettlement(
          'claim-1',
          { approvedAmount: '0.000', deductible: '0.000' },
          claims(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('409 on a re-post with different figures; a byte-identical re-post resumes the settle', async () => {
      const { service, workflow } = await settleableClaim();
      // first record with a broker-processed flag so it does NOT settle
      await service.recordSettlement(
        'claim-1',
        {
          approvedAmount: '1000.000',
          deductible: '0.000',
          brokerProcessedPayment: true,
        },
        claims(),
      );
      // different figures -> 409
      await expect(
        service.recordSettlement(
          'claim-1',
          {
            approvedAmount: '2000.000',
            deductible: '0.000',
            brokerProcessedPayment: true,
          },
          claims(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      // identical -> no-op (still needs a second approver, so no settle)
      workflow.transition.mockClear();
      const again = await service.recordSettlement(
        'claim-1',
        {
          approvedAmount: '1000.000',
          deductible: '0.000',
          brokerProcessedPayment: true,
        },
        claims(),
      );
      expect(again.status).toBe('APPROVED');
      expect(workflow.transition).not.toHaveBeenCalled();
    });

    it('a byte-identical re-post resumes a stuck settle once the required second approver is recorded — and any approver can drive it, not only that second approver', async () => {
      const deps = await settleableClaim('PARTIALLY_APPROVED');
      await deps.service.recordSettlement(
        'claim-1',
        {
          approvedAmount: '500.000',
          deductible: '0.000',
          brokerProcessedPayment: true, // -> needs a 2nd approver
        },
        claims(),
      );
      // The second approval landed but settleCore's transition threw, so the
      // claim is still at its verdict status.
      deps.claimState.settlement!.secondApproverUserId = 'mgr-1';
      deps.claimState.status = 'PARTIALLY_APPROVED';
      deps.workflow.transition.mockClear();

      // a DIFFERENT claim.settle.approve holder (neither maker nor checker)
      const view = await deps.service.recordSettlement(
        'claim-1',
        {
          approvedAmount: '500.000',
          deductible: '0.000',
          brokerProcessedPayment: true,
        },
        claims({ id: 'clm-2' }),
      );

      expect(deps.workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'Claim', toStatus: 'SETTLED' }),
      );
      expect(view.status).toBe('SETTLED');
    });

    it('404 for a caller who cannot see the claim', async () => {
      const deps = makeDeps({ customerOwner: 'someone-else' });
      await deps.service.notify({ ...BASE_DTO }, claims());
      deps.claimState.status = 'APPROVED';
      await expect(
        deps.service.recordSettlement(
          'claim-1',
          { approvedAmount: '100.000', deductible: '0.000' },
          sales(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('secondApproveSettlement', () => {
    async function pendingSecondApproval() {
      const deps = await settleableClaim();
      await deps.service.recordSettlement(
        'claim-1',
        {
          approvedAmount: '500.000',
          deductible: '0.000',
          brokerProcessedPayment: true,
        },
        claims(), // first approver = clm-1
      );
      deps.workflow.transition.mockClear();
      deps.audit.record.mockClear();
      return deps;
    }

    it('a different user second-approves -> the claim is SETTLED, an APPROVE audit is written', async () => {
      const { service, workflow, audit } = await pendingSecondApproval();

      const view = await service.secondApproveSettlement('claim-1', manager());

      expect(view.status).toBe('SETTLED');
      expect(view.settlement?.secondApproverUserId).toBe('mgr-1');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'SETTLED' }),
      );
      const appr = audit.record.mock.calls.find(
        (c) =>
          (c[0] as { entityType: string; action: string }).entityType ===
            'Settlement' && (c[0] as { action: string }).action === 'APPROVE',
      );
      expect(appr).toBeDefined();
    });

    it('403 when the second approver is the same user as the first approver (maker/checker)', async () => {
      const { service } = await pendingSecondApproval();
      await expect(
        service.secondApproveSettlement('claim-1', claims()), // clm-1 = first approver
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409 when another user already second-approved', async () => {
      const { service } = await pendingSecondApproval();
      await service.secondApproveSettlement('claim-1', manager('mgr-1'));
      await expect(
        service.secondApproveSettlement('claim-1', manager('mgr-2')),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('idempotent for the same second approver (resumes a settle that did not land)', async () => {
      const { service, workflow } = await pendingSecondApproval();
      await service.secondApproveSettlement('claim-1', manager('mgr-1'));
      workflow.transition.mockClear();
      const again = await service.secondApproveSettlement(
        'claim-1',
        manager('mgr-1'),
      );
      expect(again.status).toBe('SETTLED');
      expect(workflow.transition).not.toHaveBeenCalled();
    });

    it('422 when the settlement does not require a second approver', async () => {
      const { service } = await settleableClaim();
      await service.recordSettlement(
        'claim-1',
        { approvedAmount: '1000.000', deductible: '0.000' }, // small, not broker
        claims(),
      );
      // already SETTLED; second-approve is not applicable
      await expect(
        service.secondApproveSettlement('claim-1', manager()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('404 when there is no settlement recorded', async () => {
      const { service } = await settleableClaim();
      await expect(
        service.secondApproveSettlement('claim-1', manager()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 when the second approval is recorded concurrently (0 rows)', async () => {
      const { service, claimRepo } = await pendingSecondApproval();
      claimRepo.recordSettlementSecondApproval.mockResolvedValueOnce(null);
      await expect(
        service.secondApproveSettlement('claim-1', manager()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('fails loudly (never silently passes maker/checker) when the settlement has no recorded first approver', async () => {
      const deps = await pendingSecondApproval();
      // A first approver is always set by createSettlement, but the column is
      // nullable and the DB CHECK also passes when it is NULL — the guard must
      // not coalesce a missing maker to `'' === actor.id`.
      deps.claimState.settlement!.approvedByUserId = null;
      await expect(
        deps.service.secondApproveSettlement('claim-1', manager()),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('settleCore structurally refuses SETTLED while a required second approval is missing', async () => {
    const { service, workflow } = await settleableClaim();
    await service.recordSettlement(
      'claim-1',
      {
        approvedAmount: '900.000',
        deductible: '0.000',
        brokerProcessedPayment: true,
      },
      claims(),
    );
    workflow.transition.mockClear();
    const view = await service.recordSettlement(
      'claim-1',
      {
        approvedAmount: '900.000',
        deductible: '0.000',
        brokerProcessedPayment: true,
      },
      claims(),
    );
    expect(view.status).toBe('APPROVED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });
});

describe('ClaimService closure (Process 29)', () => {
  const CONFIRMED = '2026-08-15T00:00:00.000Z';

  /** notify -> APPROVED -> record a small settlement -> SETTLED. */
  async function settledClaim() {
    const deps = makeDeps();
    await deps.service.notify({ ...BASE_DTO }, claims());
    deps.claimState.status = 'APPROVED';
    await deps.service.recordSettlement(
      'claim-1',
      { approvedAmount: '17500.000', deductible: '2500.000' },
      claims(),
    );
    deps.workflow.transition.mockClear();
    deps.audit.record.mockClear();
    deps.lossRatio.recomputeForPolicy.mockClear();
    return deps;
  }

  async function declinedClaim() {
    const deps = makeDeps();
    await deps.service.notify({ ...BASE_DTO }, claims());
    deps.claimState.status = 'DECLINED';
    deps.workflow.transition.mockClear();
    deps.audit.record.mockClear();
    deps.lossRatio.recomputeForPolicy.mockClear();
    return deps;
  }

  it('422 when a SETTLED claim is closed without confirming the client payment receipt', async () => {
    const { service } = await settledClaim();
    await expect(
      service.closeClaim('claim-1', {}, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('closes a SETTLED claim once payment is confirmed: stamps the settlement, drives -> CLOSED, and triggers the Loss Ratio recompute', async () => {
    const { service, claimRepo, workflow, audit, lossRatio } =
      await settledClaim();

    const view = await service.closeClaim(
      'claim-1',
      { clientPaymentConfirmedAt: CONFIRMED },
      claims(),
    );

    expect(view.status).toBe('CLOSED');
    expect(view.closedAt).not.toBeNull();
    expect(view.settlement?.clientPaymentConfirmedAt).toBe(CONFIRMED);
    expect(claimRepo.confirmSettlementPayment).toHaveBeenCalledWith(
      'settlement-1',
      new Date(CONFIRMED),
    );
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Claim', toStatus: 'CLOSED' }),
    );
    expect(lossRatio.recomputeForPolicy).toHaveBeenCalledTimes(1);
    expect(lossRatio.recomputeForPolicy).toHaveBeenCalledWith(
      'pol-1',
      { reason: 'claim-closed', claimId: 'claim-1' },
      'clm-1',
    );
    const stamp = audit.record.mock.calls.find(
      (c) =>
        (c[0] as { entityType: string; action: string }).entityType ===
          'Settlement' && (c[0] as { action: string }).action === 'UPDATE',
    );
    expect(
      (stamp?.[0] as { afterValue: Record<string, unknown> }).afterValue,
    ).toMatchObject({
      claimId: 'claim-1',
      clientPaymentConfirmedAt: CONFIRMED,
    });
  });

  it('422 when the confirmed instant predates the loss date', async () => {
    const { service } = await settledClaim();
    await expect(
      service.closeClaim(
        'claim-1',
        { clientPaymentConfirmedAt: '2026-03-01T00:00:00.000Z' }, // before lossDate 2026-03-15
        claims(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a stuck close (payment already confirmed, still SETTLED): a different confirmed instant is a 409, an identical one resumes the close', async () => {
    const deps = await settledClaim();
    // Simulate a crash after the payment stamp but before the transition: the
    // Settlement carries clientPaymentConfirmedAt, the claim is still SETTLED.
    deps.claimState.settlement!.clientPaymentConfirmedAt = new Date(CONFIRMED);

    await expect(
      deps.service.closeClaim(
        'claim-1',
        { clientPaymentConfirmedAt: '2026-08-20T00:00:00.000Z' },
        claims(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    deps.workflow.transition.mockClear();
    const again = await deps.service.closeClaim(
      'claim-1',
      { clientPaymentConfirmedAt: CONFIRMED },
      claims(),
    );
    expect(again.status).toBe('CLOSED');
    expect(deps.workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'CLOSED' }),
    );
  });

  it('closes a DECLINED claim directly (no payment) and still triggers the recompute', async () => {
    const { service, workflow, lossRatio } = await declinedClaim();
    const view = await service.closeClaim('claim-1', {}, claims());
    expect(view.status).toBe('CLOSED');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'CLOSED' }),
    );
    expect(lossRatio.recomputeForPolicy).toHaveBeenCalledTimes(1);
  });

  it('422 when a clientPaymentConfirmedAt is supplied for a DECLINED claim', async () => {
    const { service } = await declinedClaim();
    await expect(
      service.closeClaim(
        'claim-1',
        { clientPaymentConfirmedAt: CONFIRMED },
        claims(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422 when the claim is not SETTLED / DECLINED / CLOSED', async () => {
    const deps = makeDeps();
    await deps.service.notify({ ...BASE_DTO }, claims());
    deps.claimState.status = 'UNDER_ASSESSMENT';
    await expect(
      deps.service.closeClaim('claim-1', {}, claims()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('an already-CLOSED claim is a 200 no-op and does NOT re-fire the recompute', async () => {
    const { service, workflow, lossRatio } = await settledClaim();
    await service.closeClaim(
      'claim-1',
      { clientPaymentConfirmedAt: CONFIRMED },
      claims(),
    );
    workflow.transition.mockClear();
    lossRatio.recomputeForPolicy.mockClear();
    const again = await service.closeClaim('claim-1', {}, claims());
    expect(again.status).toBe('CLOSED');
    expect(workflow.transition).not.toHaveBeenCalled();
    expect(lossRatio.recomputeForPolicy).not.toHaveBeenCalled();
  });

  it('404 for a caller who cannot see the claim', async () => {
    const deps = makeDeps({ customerOwner: 'someone-else' });
    await deps.service.notify({ ...BASE_DTO }, claims());
    deps.claimState.status = 'DECLINED';
    await expect(
      deps.service.closeClaim('claim-1', {}, sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still closes the claim if the Loss Ratio recompute throws (best-effort)', async () => {
    const { service, lossRatio } = await declinedClaim();
    lossRatio.recomputeForPolicy.mockRejectedValueOnce(new Error('boom'));
    const view = await service.closeClaim('claim-1', {}, claims());
    expect(view.status).toBe('CLOSED');
  });
});
