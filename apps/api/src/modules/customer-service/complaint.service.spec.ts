import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ComplaintService } from './complaint.service';
import type { ComplaintRepository } from '../../repositories/complaint.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  customerId: 'cust-1',
  claimId: null,
  policyId: null,
  issue: 'Payment short by 200 JOD',
  category: 'denied_claim',
  status: 'IN_PROGRESS',
  slaTimerId: 'sla-1',
  slaTimer: {
    id: 'sla-1',
    dueAt: new Date('2026-09-17T00:00:00.000Z'),
    escalatedAt: null,
    escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
    resolvedAt: null,
  },
  responsibleEmployeeUserId: 'u-claims',
  resolution: null,
  resolvedByUserId: null,
  resolvedAt: null,
  closureApprovedByUserId: null,
  closedAt: null,
  createdAt: new Date('2026-09-03T09:00:00.000Z'),
  actions: [],
  escalations: [],
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    userExists: vi.fn().mockResolvedValue(true),
    claimCustomerId: vi.fn().mockResolvedValue('cust-1'),
    policyCustomerId: vi.fn().mockResolvedValue('cust-1'),
    create: vi.fn().mockResolvedValue({ id: 'c-1' }),
    attachSlaTimer: vi.fn().mockResolvedValue({ count: 1 }),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([]),
    recordAssignee: vi.fn().mockResolvedValue({ count: 1 }),
    createAction: vi.fn().mockResolvedValue({ id: 'a-1' }),
    createEscalation: vi.fn().mockResolvedValue({ id: 'e-1' }),
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
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-17T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ComplaintService(
    repo as unknown as ComplaintRepository,
    workflow as unknown as WorkflowTransitionService,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, workflow, slaTimer, audit };
}

describe('ComplaintService.create (Process 42)', () => {
  it('logs at LOGGED, starts + attaches the SLA timer, writes a CREATE audit row', async () => {
    const { service, repo, slaTimer, audit } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'LOGGED' })),
      },
    });
    await service.create(
      { customerId: 'cust-1', issue: 'Payment short by 200 JOD' },
      'u-sales',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1' }),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Complaint',
        workflowName: 'complaint_resolution',
      }),
    );
    expect(repo.attachSlaTimer).toHaveBeenCalledWith('c-1', 'sla-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'Complaint' }),
    );
  });

  it('404s an unknown customer before writing', async () => {
    const { service, repo } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create({ customerId: 'nope', issue: 'xxx' }, 'u-sales'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('404s an unknown claim and 422s a claim that belongs to another customer', async () => {
    const notFound = makeService({
      repo: { claimCustomerId: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      notFound.service.create(
        { customerId: 'cust-1', issue: 'xxx', claimId: 'claim-x' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const mismatch = makeService({
      repo: { claimCustomerId: vi.fn().mockResolvedValue('cust-2') },
    });
    await expect(
      mismatch.service.create(
        { customerId: 'cust-1', issue: 'xxx', claimId: 'claim-2' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('still returns when the SLA timer start fails (best-effort)', async () => {
    const { service, slaTimer, repo, audit } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'LOGGED' })) },
    });
    slaTimer.startTimer.mockRejectedValueOnce(new Error('sla down'));
    await service.create({ customerId: 'cust-1', issue: 'xxx' }, 'u-sales');
    expect(repo.attachSlaTimer).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE' }),
    );
  });
});

describe('ComplaintService.assign (Process 42)', () => {
  it('from LOGGED: drives LOGGED -> ASSIGNED through the engine with the assignee', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'LOGGED' }))
          .mockResolvedValue(row({ status: 'ASSIGNED' })),
      },
    });
    await service.assign('c-1', 'u-claims', 'u-mgr');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Complaint',
        toStatus: 'ASSIGNED',
        data: { responsibleEmployeeUserId: 'u-claims' },
      }),
    );
  });

  it('from IN_PROGRESS: reassigns without a status change', async () => {
    const { service, repo, workflow } = makeService();
    await service.assign('c-1', 'u-other', 'u-mgr');
    expect(repo.recordAssignee).toHaveBeenCalledWith('c-1', 'u-other');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('422s reassigning a CLOSED or RESOLVED complaint', async () => {
    for (const status of ['CLOSED', 'RESOLVED']) {
      const { service } = makeService({
        repo: { findById: vi.fn().mockResolvedValue(row({ status })) },
      });
      await expect(
        service.assign('c-1', 'u-x', 'u-mgr'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('404s an unknown assignee', async () => {
    const { service } = makeService({
      repo: { userExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.assign('c-1', 'ghost', 'u-mgr'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('0 rows on the non-transition path -> 409', async () => {
    const { service } = makeService({
      repo: {
        recordAssignee: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi.fn().mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    await expect(service.assign('c-1', 'u-x', 'u-mgr')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ComplaintService.start (Process 42)', () => {
  it('idempotent when already IN_PROGRESS', async () => {
    const { service, workflow } = makeService();
    const v = await service.start('c-1', 'u-claims');
    expect(v.status).toBe('IN_PROGRESS');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('drives ASSIGNED -> IN_PROGRESS through the engine + an UPDATE audit', async () => {
    const { service, workflow, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'ASSIGNED' }))
          .mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    await service.start('c-1', 'u-claims');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'IN_PROGRESS' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'Complaint' }),
    );
  });

  it('422s CLOSED and RESOLVED', async () => {
    for (const status of ['CLOSED', 'RESOLVED']) {
      const { service } = makeService({
        repo: { findById: vi.fn().mockResolvedValue(row({ status })) },
      });
      await expect(service.start('c-1', 'u-x')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    }
  });

  it('concurrent double-start: engine 409, row now IN_PROGRESS -> idempotent 200', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'ASSIGNED' }))
          .mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    workflow.transition.mockRejectedValueOnce(
      new ConflictException('status changed concurrently'),
    );
    const v = await service.start('c-1', 'u-claims');
    expect(v.status).toBe('IN_PROGRESS');
  });

  it('concurrent double-start: engine 409, row now elsewhere -> rethrows 409', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'ASSIGNED' }))
          .mockResolvedValue(row({ status: 'RESOLVED' })),
      },
    });
    workflow.transition.mockRejectedValueOnce(
      new ConflictException('status changed concurrently'),
    );
    await expect(service.start('c-1', 'u-claims')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ComplaintService.addAction (Process 42)', () => {
  it('appends an action + a CREATE audit row while open', async () => {
    const { service, repo, audit } = makeService();
    await service.addAction(
      'c-1',
      { actionText: 'Chased the insurer' },
      'u-claims',
    );
    expect(repo.createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionText: 'Chased the insurer',
        takenByUserId: 'u-claims',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'ComplaintAction',
      }),
    );
  });

  it('422s adding an action to a CLOSED complaint', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'CLOSED' })) },
    });
    await expect(
      service.addAction('c-1', { actionText: 'x' }, 'u-claims'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ComplaintService.resolve (Process 42)', () => {
  const RES = 'Insurer paid the difference; customer accepted.';

  it('drives -> RESOLVED with resolvedByUserId, resolves the SLA, writes an UPDATE audit', async () => {
    const { service, workflow, slaTimer, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IN_PROGRESS' }))
          .mockResolvedValue(
            row({
              status: 'RESOLVED',
              resolution: RES,
              resolvedByUserId: 'u-claims',
            }),
          ),
      },
    });
    const v = await service.resolve('c-1', { resolution: RES }, 'u-claims');
    const call = workflow.transition.mock.calls[0]?.[0] as {
      toStatus: string;
      data?: Record<string, unknown>;
    };
    expect(call.toStatus).toBe('RESOLVED');
    expect(call.data).toMatchObject({
      resolution: RES,
      resolvedByUserId: 'u-claims',
    });
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Complaint' }),
    );
    expect(v.status).toBe('RESOLVED');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });

  it('idempotent on a re-resolve with the same text; 409 on different', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            status: 'RESOLVED',
            resolution: RES,
            resolvedByUserId: 'u-claims',
          }),
        ),
      },
    });
    const v = await service.resolve('c-1', { resolution: RES }, 'u-claims');
    expect(v.status).toBe('RESOLVED');
    await expect(
      service.resolve(
        'c-1',
        { resolution: 'something else entirely' },
        'u-claims',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('422s resolving a CLOSED complaint', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(row({ status: 'CLOSED' })) },
    });
    await expect(
      service.resolve('c-1', { resolution: RES }, 'u-claims'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ComplaintService.escalate (Process 42)', () => {
  it('drives IN_PROGRESS -> ESCALATED, writes an EscalationRecord + audit, resolves the SLA', async () => {
    const { service, workflow, repo, slaTimer, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IN_PROGRESS' }))
          .mockResolvedValue(row({ status: 'ESCALATED' })),
      },
    });
    await service.escalate(
      'c-1',
      { reason: 'insurer silent 25 days' },
      'u-mgr',
    );
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ESCALATED' }),
    );
    expect(repo.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        escalatedTo: 'dispute_resolution_committee',
        escalatedByUserId: 'u-mgr',
        reason: 'insurer silent 25 days',
      }),
    );
    expect(slaTimer.resolve).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'EscalationRecord' }),
    );
  });

  it('idempotent no-op when already ESCALATED (no transition, no new record — a count-then-create self-heal would be the race race-safe-invariants.md forbids)', async () => {
    const { service, repo, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'ESCALATED' })),
      },
    });
    const v = await service.escalate('c-1', {}, 'u-mgr');
    expect(v.status).toBe('ESCALATED');
    expect(workflow.transition).not.toHaveBeenCalled();
    expect(repo.createEscalation).not.toHaveBeenCalled();
  });

  it('defaults escalatedTo to the dispute-resolution committee when omitted', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IN_PROGRESS' }))
          .mockResolvedValue(row({ status: 'ESCALATED' })),
      },
    });
    await service.escalate('c-1', {}, 'u-mgr');
    expect(repo.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ escalatedTo: 'dispute_resolution_committee' }),
    );
  });

  it('422s escalating a CLOSED or RESOLVED complaint', async () => {
    for (const status of ['CLOSED', 'RESOLVED']) {
      const { service } = makeService({
        repo: { findById: vi.fn().mockResolvedValue(row({ status })) },
      });
      await expect(service.escalate('c-1', {}, 'u-mgr')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    }
  });
});

describe('ComplaintService.close (Process 42) — mandatory supervisor sign-off', () => {
  it('RESOLVED -> CLOSED by a different user, stamping closureApprovedByUserId + closedAt', async () => {
    const { service, workflow, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ status: 'RESOLVED', resolvedByUserId: 'u-claims' }),
          )
          .mockResolvedValue(
            row({
              status: 'CLOSED',
              resolvedByUserId: 'u-claims',
              closureApprovedByUserId: 'u-mgr',
            }),
          ),
      },
    });
    const v = await service.close('c-1', 'u-mgr');
    const call = workflow.transition.mock.calls[0]?.[0] as {
      toStatus: string;
      data?: Record<string, unknown>;
    };
    expect(call.toStatus).toBe('CLOSED');
    expect(call.data).toMatchObject({ closureApprovedByUserId: 'u-mgr' });
    expect(slaTimer.resolve).toHaveBeenCalled();
    expect(v.status).toBe('CLOSED');
  });

  it('403s when the closer is the same user who resolved it', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'RESOLVED', resolvedByUserId: 'u-claims' }),
          ),
      },
    });
    await expect(service.close('c-1', 'u-claims')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('422s closing a complaint that is not RESOLVED', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'IN_PROGRESS' })),
      },
    });
    await expect(service.close('c-1', 'u-mgr')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('fails CLOSED: a RESOLVED complaint with no recorded resolver -> 422, not a vacuous pass', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'RESOLVED', resolvedByUserId: null }),
          ),
      },
    });
    await expect(service.close('c-1', 'u-mgr')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('idempotent when already CLOSED', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'CLOSED' })),
      },
    });
    const v = await service.close('c-1', 'u-mgr');
    expect(v.status).toBe('CLOSED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });
});
