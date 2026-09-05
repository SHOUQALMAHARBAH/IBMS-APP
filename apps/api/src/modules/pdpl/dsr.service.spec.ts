import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DsrService } from './dsr.service';
import type { DsrRepository } from '../../repositories/dsr.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'dsr-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  type: 'ACCESS',
  status: 'RECEIVED',
  receivedAt: new Date('2026-09-01T09:00:00.000Z'),
  identityVerifiedAt: null,
  slaDueAt: new Date('2026-09-22T00:00:00.000Z'),
  accessExtensionAppliedAt: null,
  extensionReason: null,
  retentionScheduleReference: null,
  partialFulfilmentJustification: null,
  closedAt: null,
  dpoHandlerUserId: null,
  processedByUserId: null,
  closedByUserId: null,
  rejectionReason: null,
  noOpenRetentionHoldConfirmedAt: null,
  createdAt: new Date('2026-09-01T09:00:00.000Z'),
  ...over,
});

function makeService(
  over: {
    repo?: Record<string, unknown>;
    slaTimer?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    insuredPersonExists: vi.fn().mockResolvedValue(true),
    userExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([]),
    recordHandlerAssignment: vi.fn().mockResolvedValue({ count: 1 }),
    applyExtension: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const workflow = {
    transition: vi
      .fn()
      .mockImplementation(
        async (params: {
          entityId: string;
          toStatus: string;
          sideEffect?: (r: { id: string; status: string }) => Promise<void>;
        }) => {
          if (params.sideEffect) {
            await params.sideEffect({
              id: params.entityId,
              status: params.toStatus,
            });
          }
          return { id: params.entityId, status: params.toStatus };
        },
      ),
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-22T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.slaTimer,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DsrService(
    repo as unknown as DsrRepository,
    workflow as unknown as WorkflowTransitionService,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, workflow, slaTimer, audit };
}

describe('DsrService.create (M04)', () => {
  it('422s when neither/both of customerId/insuredPersonId are set', async () => {
    const { service } = makeService();
    await expect(
      service.create({ type: 'ACCESS' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create(
        { customerId: 'c', insuredPersonId: 'i', type: 'ACCESS' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('404s an unknown customer / insuredPerson / dpoHandlerUserId', async () => {
    const notFoundCustomer = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      notFoundCustomer.service.create(
        { customerId: 'nope', type: 'ACCESS' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const notFoundHandler = makeService({
      repo: { userExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      notFoundHandler.service.create(
        {
          customerId: 'cust-1',
          type: 'ACCESS',
          dpoHandlerUserId: 'nope',
        },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('routes ACCESS/DELETION to dsr_access_deletion and starts an SLA timer, then audits CREATE (sensitive)', async () => {
    const { service, repo, slaTimer, audit } = makeService();
    await service.create({ customerId: 'cust-1', type: 'ACCESS' }, 'u-dpo');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', type: 'ACCESS' }),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'DataSubjectRequest',
        workflowName: 'dsr_access_deletion',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('routes CORRECTION/OBJECTION to dsr_correction_objection', async () => {
    const { service, slaTimer } = makeService();
    await service.create({ customerId: 'cust-1', type: 'CORRECTION' }, 'u-dpo');
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'dsr_correction_objection' }),
    );
  });
});

describe('DsrService.verifyIdentity (M04)', () => {
  it('RECEIVED -> IDENTITY_VERIFIED, stamping identityVerifiedAt', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'RECEIVED' }))
          .mockResolvedValue(
            row({
              status: 'IDENTITY_VERIFIED',
              identityVerifiedAt: new Date(),
            }),
          ),
      },
    });
    const v = await service.verifyIdentity('dsr-1', 'u-dpo');
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'IDENTITY_VERIFIED',
    });
    expect(v.status).toBe('IDENTITY_VERIFIED');
  });

  it('is idempotent if already IDENTITY_VERIFIED', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'IDENTITY_VERIFIED' })),
      },
    });
    const v = await service.verifyIdentity('dsr-1', 'u-dpo');
    expect(v.status).toBe('IDENTITY_VERIFIED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('a genuinely concurrent double-call is race-safe (engine ConflictException -> reload idempotent)', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'RECEIVED' }))
          .mockResolvedValue(row({ status: 'IDENTITY_VERIFIED' })),
      },
    });
    workflow.transition = vi
      .fn()
      .mockRejectedValue(new ConflictException('race'));
    const v = await service.verifyIdentity('dsr-1', 'u-dpo');
    expect(v.status).toBe('IDENTITY_VERIFIED');
  });
});

describe('DsrService.start (M04)', () => {
  it('IDENTITY_VERIFIED -> IN_PROGRESS', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IDENTITY_VERIFIED' }))
          .mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    const v = await service.start('dsr-1', 'u-dpo');
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'IN_PROGRESS',
    });
    expect(v.status).toBe('IN_PROGRESS');
  });

  it('is idempotent if already IN_PROGRESS', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    const v = await service.start('dsr-1', 'u-dpo');
    expect(v.status).toBe('IN_PROGRESS');
  });
});

describe('DsrService.assign (M04)', () => {
  it('404s an unknown dpoHandlerUserId', async () => {
    const { service } = makeService({
      repo: { userExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.assign('dsr-1', { dpoHandlerUserId: 'nope' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s once processed or closed', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'FULFILLED' })),
      },
    });
    await expect(
      service.assign('dsr-1', { dpoHandlerUserId: 'u-2' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('records the handler while RECEIVED/IDENTITY_VERIFIED/IN_PROGRESS', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IN_PROGRESS' }))
          .mockResolvedValue(
            row({ status: 'IN_PROGRESS', dpoHandlerUserId: 'u-2' }),
          ),
      },
    });
    const v = await service.assign(
      'dsr-1',
      { dpoHandlerUserId: 'u-2' },
      'u-dpo',
    );
    expect(repo.recordHandlerAssignment).toHaveBeenCalledWith('dsr-1', 'u-2');
    expect(v.dpoHandlerUserId).toBe('u-2');
  });
});

describe('DsrService.applyExtension (M04)', () => {
  it('422s for a non-ACCESS type', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ type: 'CORRECTION', status: 'IN_PROGRESS' }),
          ),
      },
    });
    await expect(
      service.applyExtension('dsr-1', { reason: 'r' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s if already applied (write-once)', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            type: 'ACCESS',
            status: 'IN_PROGRESS',
            accessExtensionAppliedAt: new Date('2026-09-10T00:00:00.000Z'),
          }),
        ),
      },
    });
    await expect(
      service.applyExtension('dsr-1', { reason: 'r' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s once processed or closed', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ type: 'ACCESS', status: 'REJECTED' })),
      },
    });
    await expect(
      service.applyExtension('dsr-1', { reason: 'r' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('re-bases slaDueAt forward and resolves+restarts the SLA timer', async () => {
    const { service, repo, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({
              type: 'ACCESS',
              status: 'IN_PROGRESS',
              slaDueAt: new Date('2026-09-22T00:00:00.000Z'),
            }),
          )
          .mockResolvedValue(
            row({
              type: 'ACCESS',
              status: 'IN_PROGRESS',
              slaDueAt: new Date('2026-10-13T00:00:00.000Z'),
              accessExtensionAppliedAt: new Date(),
              extensionReason: 'Complex request needing more records.',
            }),
          ),
      },
    });
    const v = await service.applyExtension(
      'dsr-1',
      { reason: 'Complex request needing more records.' },
      'u-dpo',
    );
    expect(repo.applyExtension).toHaveBeenCalledWith(
      'dsr-1',
      expect.any(Date),
      'Complex request needing more records.',
      expect.any(Date),
    );
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'dsr_access_deletion' }),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'dsr_access_deletion' }),
    );
    expect(v.extensionReason).toBe('Complex request needing more records.');
  });

  it('starts the new timer BEFORE resolving the old one, and only resolves if start succeeded (review-fix regression)', async () => {
    const calls: string[] = [];
    const { service, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ type: 'ACCESS', status: 'IN_PROGRESS' }))
          .mockResolvedValue(row({ type: 'ACCESS', status: 'IN_PROGRESS' })),
      },
      slaTimer: {
        startTimer: vi.fn().mockImplementation(() => {
          calls.push('start');
          return Promise.resolve([{ id: 'sla-new' }]);
        }),
        resolve: vi.fn().mockImplementation(() => {
          calls.push('resolve');
          return Promise.resolve({ count: 1 });
        }),
      },
    });

    await service.applyExtension('dsr-1', { reason: 'r' }, 'u-dpo');

    expect(calls).toEqual(['start', 'resolve']);
    // resolve() must exclude the row startTimer() just created — the
    // createdBefore cutoff is captured before either call runs.
    const resolveCall = slaTimer.resolve.mock.calls[0]?.[0] as {
      createdBefore?: Date;
    };
    expect(resolveCall.createdBefore).toBeInstanceOf(Date);
  });

  it('never resolves the pre-extension timer if starting the new one failed — leaves the old timer open rather than a silent gap', async () => {
    const { service, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ type: 'ACCESS', status: 'IN_PROGRESS' }))
          .mockResolvedValue(row({ type: 'ACCESS', status: 'IN_PROGRESS' })),
      },
      slaTimer: {
        startTimer: vi.fn().mockRejectedValue(new Error('db blip')),
        resolve: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await service.applyExtension('dsr-1', { reason: 'r' }, 'u-dpo');

    expect(slaTimer.resolve).not.toHaveBeenCalled();
  });
});

describe('DsrService.fulfil (M04)', () => {
  it('422s a DELETION fulfil with no confirmNoOpenRetentionHold', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ type: 'DELETION', status: 'IN_PROGRESS' })),
      },
    });
    await expect(service.fulfil('dsr-1', {}, 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('fulfils a DELETION with confirmNoOpenRetentionHold: true', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ type: 'DELETION', status: 'IN_PROGRESS' }),
          )
          .mockResolvedValue(
            row({
              type: 'DELETION',
              status: 'FULFILLED',
              processedByUserId: 'u-dpo',
            }),
          ),
      },
    });
    const v = await service.fulfil(
      'dsr-1',
      { confirmNoOpenRetentionHold: true },
      'u-dpo',
    );
    // Review-fix regression: the attestation must be PERSISTED (and
    // therefore auditable), not merely checked in-memory and discarded.
    const call = workflow.transition.mock.calls[0]?.[0] as {
      toStatus: string;
      data: {
        processedByUserId: string;
        noOpenRetentionHoldConfirmedAt: unknown;
      };
    };
    expect(call.toStatus).toBe('FULFILLED');
    expect(call.data.processedByUserId).toBe('u-dpo');
    expect(call.data.noOpenRetentionHoldConfirmedAt).toBeInstanceOf(Date);
    expect(v.status).toBe('FULFILLED');
  });

  it('fulfils a non-DELETION type with no confirmation needed, and never stamps the DELETION-only attestation', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ type: 'ACCESS', status: 'IN_PROGRESS' }))
          .mockResolvedValue(row({ type: 'ACCESS', status: 'FULFILLED' })),
      },
    });
    const v = await service.fulfil('dsr-1', {}, 'u-dpo');
    expect(v.status).toBe('FULFILLED');
    expect(
      (
        workflow.transition.mock.calls[0]?.[0] as {
          data: Record<string, unknown>;
        }
      ).data,
    ).not.toHaveProperty('noOpenRetentionHoldConfirmedAt');
  });

  it('is idempotent if already FULFILLED', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'FULFILLED' })),
      },
    });
    const v = await service.fulfil('dsr-1', {}, 'u-dpo');
    expect(v.status).toBe('FULFILLED');
  });

  it('a genuinely concurrent double-call is race-safe (engine ConflictException -> reload idempotent)', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ type: 'ACCESS', status: 'IN_PROGRESS' }))
          .mockResolvedValue(row({ type: 'ACCESS', status: 'FULFILLED' })),
      },
    });
    workflow.transition = vi
      .fn()
      .mockRejectedValue(new ConflictException('race'));
    const v = await service.fulfil('dsr-1', {}, 'u-dpo');
    expect(v.status).toBe('FULFILLED');
  });
});

describe('DsrService.partiallyFulfil (M04)', () => {
  const DTO = {
    retentionScheduleReference: 'RSI-2026-001',
    partialFulfilmentJustification: '7-year statutory retention still open.',
  };

  it('stamps the reference/justification/processedByUserId', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ type: 'DELETION', status: 'IN_PROGRESS' }),
          )
          .mockResolvedValue(
            row({ type: 'DELETION', status: 'PARTIALLY_FULFILLED', ...DTO }),
          ),
      },
    });
    const v = await service.partiallyFulfil('dsr-1', DTO, 'u-dpo');
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'PARTIALLY_FULFILLED',
      data: { ...DTO, processedByUserId: 'u-dpo' },
    });
    expect(v.status).toBe('PARTIALLY_FULFILLED');
  });

  it('idempotent on a re-call with the same reference/justification; 409 on different', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'PARTIALLY_FULFILLED', ...DTO })),
      },
    });
    const v = await service.partiallyFulfil('dsr-1', DTO, 'u-dpo');
    expect(v.status).toBe('PARTIALLY_FULFILLED');

    await expect(
      service.partiallyFulfil(
        'dsr-1',
        { ...DTO, partialFulfilmentJustification: 'different' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a genuinely concurrent double-call with the SAME payload is race-safe (engine ConflictException -> reload idempotent)', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ type: 'DELETION', status: 'IN_PROGRESS' }),
          )
          .mockResolvedValue(
            row({ type: 'DELETION', status: 'PARTIALLY_FULFILLED', ...DTO }),
          ),
      },
    });
    workflow.transition = vi
      .fn()
      .mockRejectedValue(new ConflictException('race'));
    const v = await service.partiallyFulfil('dsr-1', DTO, 'u-dpo');
    expect(v.status).toBe('PARTIALLY_FULFILLED');
  });

  it('a genuinely concurrent double-call with a DIFFERENT payload still throws (does not paper over a real conflict)', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ type: 'DELETION', status: 'IN_PROGRESS' }),
          )
          .mockResolvedValue(
            row({ type: 'DELETION', status: 'PARTIALLY_FULFILLED', ...DTO }),
          ),
      },
    });
    workflow.transition = vi
      .fn()
      .mockRejectedValue(new ConflictException('race'));
    await expect(
      service.partiallyFulfil(
        'dsr-1',
        { ...DTO, partialFulfilmentJustification: 'different' },
        'u-dpo',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DsrService.reject (M04)', () => {
  it('stamps rejectionReason + processedByUserId', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'RECEIVED' }))
          .mockResolvedValue(
            row({
              status: 'REJECTED',
              rejectionReason: 'Not a valid subject.',
            }),
          ),
      },
    });
    const v = await service.reject(
      'dsr-1',
      { reason: 'Not a valid subject.' },
      'u-dpo',
    );
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'REJECTED',
      data: {
        rejectionReason: 'Not a valid subject.',
        processedByUserId: 'u-dpo',
      },
    });
    expect(v.status).toBe('REJECTED');
  });

  it('idempotent on a re-call with the same reason; 409 on different', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'REJECTED', rejectionReason: 'x' })),
      },
    });
    const v = await service.reject('dsr-1', { reason: 'x' }, 'u-dpo');
    expect(v.status).toBe('REJECTED');
    await expect(
      service.reject('dsr-1', { reason: 'y' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a genuinely concurrent double-call with the SAME reason is race-safe (engine ConflictException -> reload idempotent)', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'RECEIVED' }))
          .mockResolvedValue(row({ status: 'REJECTED', rejectionReason: 'x' })),
      },
    });
    workflow.transition = vi
      .fn()
      .mockRejectedValue(new ConflictException('race'));
    const v = await service.reject('dsr-1', { reason: 'x' }, 'u-dpo');
    expect(v.status).toBe('REJECTED');
  });
});

describe('DsrService.close (M04) — mandatory DPO sign-off', () => {
  it('422s when not yet processed', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    await expect(service.close('dsr-1', 'u-dpo-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s (fail closed) if processed but has no recorded processor', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'FULFILLED', processedByUserId: null }),
          ),
      },
    });
    await expect(service.close('dsr-1', 'u-dpo-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('403s when the closer is the same DPO officer who processed it', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'FULFILLED', processedByUserId: 'u-dpo-1' }),
          ),
      },
    });
    await expect(service.close('dsr-1', 'u-dpo-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('closes by a different DPO officer, stamping closedByUserId + closedAt', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ status: 'FULFILLED', processedByUserId: 'u-dpo-1' }),
          )
          .mockResolvedValue(
            row({
              status: 'CLOSED',
              processedByUserId: 'u-dpo-1',
              closedByUserId: 'u-dpo-2',
            }),
          ),
      },
    });
    const v = await service.close('dsr-1', 'u-dpo-2');
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'CLOSED',
      data: { closedByUserId: 'u-dpo-2' },
    });
    expect(v.status).toBe('CLOSED');
  });

  it('is idempotent if already CLOSED', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'CLOSED' })) },
    });
    const v = await service.close('dsr-1', 'anyone');
    expect(v.status).toBe('CLOSED');
  });

  it('a genuinely concurrent double-close is race-safe (engine ConflictException -> reload idempotent)', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ status: 'FULFILLED', processedByUserId: 'u-dpo-1' }),
          )
          .mockResolvedValue(
            row({
              status: 'CLOSED',
              processedByUserId: 'u-dpo-1',
              closedByUserId: 'u-dpo-2',
            }),
          ),
      },
    });
    workflow.transition = vi
      .fn()
      .mockRejectedValue(new ConflictException('race'));
    const v = await service.close('dsr-1', 'u-dpo-2');
    expect(v.status).toBe('CLOSED');
  });
});

describe('DsrService reads (M04) — audited (sensitive)', () => {
  it('get() writes a READ audit row', async () => {
    const { service, audit } = makeService();
    await service.get('dsr-1', 'u-dpo');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'DataSubjectRequest',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('list() writes a READ audit row and passes filters through', async () => {
    const { service, repo, audit } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue([row()]) },
    });
    await service.list({ customerId: 'cust-1' }, 'u-dpo');
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1' }),
      expect.any(Number),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'READ', entityId: 'list' }),
    );
  });
});
