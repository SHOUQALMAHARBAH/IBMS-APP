import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { ClaimService } from './claim.service';
import type { ClaimRepository } from '../../repositories/claim.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { EncryptionService } from '../security/encryption.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotifyClaimDto } from './dto/notify-claim.dto';

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
            claimNumber: null,
            status: 'NOTIFIED',
            classification: 'HIGHLY_CONFIDENTIAL',
            followUpAlertThresholdDays: 9,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...claim,
          };
          stored.push(row);
          return Promise.resolve({
            claim: row,
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
    findById: vi.fn().mockImplementation(() => {
      const row = stored[stored.length - 1];
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        ...row,
        policy: policyRow,
        thirdParty: row.isThirdPartyInvolved
          ? {
              id: 'tp-1',
              fullName: 'Third Party',
              contactDetailsEnc: 'enc:xxx',
              subrogationRecoveryFlag: false,
            }
          : null,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'NOTIFIED',
            changedByUserId: row.notifiedByUserId,
            changedAt: new Date(),
          },
        ],
      });
    }),
    findManyByPolicyId: vi.fn().mockResolvedValue([]),
    findManyByCustomerId: vi.fn().mockResolvedValue([]),
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

  const service = new ClaimService(
    claimRepo as unknown as ClaimRepository,
    policyRepo as unknown as PolicyRepository,
    customerRepo as unknown as CustomerRepository,
    audit as unknown as AuditService,
    encryption as unknown as EncryptionService,
  );

  return { service, claimRepo, policyRepo, customerRepo, audit, encryption };
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
        statusHistory: [],
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
      statusHistory: [],
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
