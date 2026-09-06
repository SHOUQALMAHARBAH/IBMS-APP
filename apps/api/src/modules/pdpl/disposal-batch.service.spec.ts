import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { DisposalBatchService } from './disposal-batch.service';
import type { DisposalBatchRepository } from '../../repositories/disposal-batch.repository';
import type { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'db-1',
  retentionScheduleItemId: 'rsi-1',
  status: 'NOMINATED',
  nominatedByUserId: 'u-manager',
  managerApprovedAt: null,
  dpoApprovedByUserId: null,
  dpoApprovedAt: null,
  method: null,
  executedAt: null,
  slaDueAt: null,
  createdAt: new Date('2026-09-14T00:00:00.000Z'),
  ...over,
});

function makeService(
  over: {
    repo?: Record<string, unknown>;
    legalHolds?: Record<string, unknown>;
    workflow?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    retentionScheduleItemExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    findCertificateByBatchId: vi.fn().mockResolvedValue(null),
    createCertificate: vi.fn().mockResolvedValue({ id: 'cert-1' }),
    ...over.repo,
  };
  const legalHolds = {
    hasActiveHold: vi.fn().mockResolvedValue(false),
    ...over.legalHolds,
  };
  const workflow = {
    transition: vi
      .fn()
      .mockImplementation((params: { toStatus: string }) =>
        Promise.resolve({ id: 'db-1', status: params.toStatus }),
      ),
    ...over.workflow,
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-10-14T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DisposalBatchService(
    repo as unknown as DisposalBatchRepository,
    legalHolds as unknown as LegalHoldRepository,
    workflow as unknown as WorkflowTransitionService,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, legalHolds, workflow, slaTimer, audit };
}

describe('DisposalBatchService.nominate', () => {
  it('creates a batch owned by the nominating manager', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.nominate(
      { retentionScheduleItemId: 'rsi-1' },
      'u-manager',
    );
    expect(v.status).toBe('NOMINATED');
    expect(repo.create).toHaveBeenCalledWith({
      retentionScheduleItemId: 'rsi-1',
      nominatedByUserId: 'u-manager',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'DisposalBatch',
      }),
    );
  });

  it('404s an unknown retentionScheduleItemId', async () => {
    const { service } = makeService({
      repo: { retentionScheduleItemExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.nominate({ retentionScheduleItemId: 'nope' }, 'u-manager'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s nominating a category under an active Legal Hold', async () => {
    const { service, repo } = makeService({
      legalHolds: { hasActiveHold: vi.fn().mockResolvedValue(true) },
    });
    await expect(
      service.nominate({ retentionScheduleItemId: 'rsi-1' }, 'u-manager'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('allows a batch with no retentionScheduleItemId — nothing to exclude against', async () => {
    const { service, legalHolds } = makeService();
    await service.nominate({}, 'u-manager');
    expect(legalHolds.hasActiveHold).not.toHaveBeenCalled();
  });
});

describe('DisposalBatchService.managerApprove', () => {
  it('transitions NOMINATED -> MANAGER_APPROVED', async () => {
    const { service, workflow } = makeService();
    await service.managerApprove('db-1', 'u-manager');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'MANAGER_APPROVED' }),
    );
  });

  it('re-checks the active Legal Hold at this step too', async () => {
    const { service } = makeService({
      legalHolds: { hasActiveHold: vi.fn().mockResolvedValue(true) },
    });
    await expect(
      service.managerApprove('db-1', 'u-manager'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('is idempotent if already MANAGER_APPROVED', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'MANAGER_APPROVED' })),
      },
    });
    const v = await service.managerApprove('db-1', 'u-manager');
    expect(v.status).toBe('MANAGER_APPROVED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });
});

describe('DisposalBatchService.dpoApprove', () => {
  it('403s the same user who nominated the batch (maker/checker segregation)', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'MANAGER_APPROVED' })),
      },
    });
    await expect(
      service.dpoApprove('db-1', 'u-manager'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approves, stamping slaDueAt (30 days from THIS approval) and starting the execution SLA timer', async () => {
    const { service, workflow, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'MANAGER_APPROVED' })),
      },
    });
    await service.dpoApprove('db-1', 'u-dpo');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'DPO_APPROVED' }),
    );
    expect(slaTimer.computeDueAt).toHaveBeenCalledWith(
      'disposal_batch_execution',
      expect.any(Date),
    );
    // the sideEffect callback starts the timer
    const call = workflow.transition.mock.calls[0][0] as {
      data: { dpoApprovedByUserId: string };
      sideEffect: () => Promise<void>;
    };
    expect(call.data.dpoApprovedByUserId).toBe('u-dpo');
    await call.sideEffect();
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'DisposalBatch',
        workflowName: 'disposal_batch_execution',
      }),
    );
  });

  it('re-checks the active Legal Hold at this step too', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'MANAGER_APPROVED' })),
      },
      legalHolds: { hasActiveHold: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.dpoApprove('db-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('DisposalBatchService.execute', () => {
  it('records the destruction method and resolves the execution SLA timer', async () => {
    const { service, workflow, slaTimer } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'DPO_APPROVED' })),
      },
    });
    await service.execute('db-1', { method: 'certified_shredding' }, 'u-dpo');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'EXECUTED' }),
    );
    const call = workflow.transition.mock.calls[0][0] as {
      data: { method: string };
      sideEffect: () => Promise<void>;
    };
    expect(call.data.method).toBe('certified_shredding');
    await call.sideEffect();
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'DisposalBatch',
        workflowName: 'disposal_batch_execution',
      }),
    );
  });

  it('is idempotent with the same method', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'EXECUTED', method: 'certified_shredding' }),
          ),
      },
    });
    const v = await service.execute(
      'db-1',
      { method: 'certified_shredding' },
      'u-dpo',
    );
    expect(v.status).toBe('EXECUTED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('409s a re-execute with a different method', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'EXECUTED', method: 'certified_shredding' }),
          ),
      },
    });
    await expect(
      service.execute('db-1', { method: 'physical_destruction' }, 'u-dpo'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DisposalBatchService.issueCertificate', () => {
  it('issues a certificate once EXECUTED', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'EXECUTED' })),
      },
    });
    await service.issueCertificate('db-1', 'u-dpo');
    expect(repo.createCertificate).toHaveBeenCalledWith({
      disposalBatchId: 'db-1',
      issuedByUserId: 'u-dpo',
    });
  });

  it('422s issuing a certificate before EXECUTED', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'DPO_APPROVED' })),
      },
    });
    await expect(
      service.issueCertificate('db-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.createCertificate).not.toHaveBeenCalled();
  });

  it('409s a duplicate certificate for the same batch', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'EXECUTED' })),
        createCertificate: vi.fn().mockRejectedValue(p2002()),
      },
    });
    await expect(
      service.issueCertificate('db-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DisposalBatchService.close', () => {
  it('422s closing without a Certificate of Destruction attached', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'EXECUTED' })),
      },
    });
    await expect(service.close('db-1', 'u-dpo')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('closes once a certificate is attached', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'EXECUTED' })),
        findCertificateByBatchId: vi.fn().mockResolvedValue({ id: 'cert-1' }),
      },
    });
    await service.close('db-1', 'u-dpo');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'CLOSED' }),
    );
  });

  it('is idempotent if already CLOSED', async () => {
    const { service, workflow } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'CLOSED' })) },
    });
    const v = await service.close('db-1', 'u-dpo');
    expect(v.status).toBe('CLOSED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });
});

describe('DisposalBatchService reads', () => {
  it('lists batches with filters passed through', async () => {
    const { service, repo } = makeService();
    await service.list({ retentionScheduleItemId: 'rsi-1' });
    expect(repo.findMany).toHaveBeenCalledWith({
      retentionScheduleItemId: 'rsi-1',
      status: undefined,
    });
  });

  it('404s an unknown batch on get', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
