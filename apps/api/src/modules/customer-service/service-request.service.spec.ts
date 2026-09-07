import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ServiceRequestService } from './service-request.service';
import type { ServiceRequestRepository } from '../../repositories/service-request.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';

const requestRow = (over: Record<string, unknown> = {}) => ({
  id: 'sr-1',
  customerId: 'cust-1',
  policyId: null,
  requestType: 'certificate',
  detail: 'Certificate for the landlord',
  status: 'open',
  slaTimerId: 'sla-1',
  slaTimer: {
    id: 'sla-1',
    dueAt: new Date('2026-09-10T00:00:00.000Z'),
    escalatedAt: null,
    escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
    resolvedAt: null,
  },
  raisedByUserId: 'u-sales',
  assignedToUserId: null,
  fulfilledByUserId: null,
  outcomeNote: null,
  createdAt: new Date('2026-09-03T09:00:00.000Z'),
  closedAt: null,
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    policyCustomerId: vi.fn().mockResolvedValue('cust-1'),
    userExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(requestRow()),
    attachSlaTimer: vi.fn().mockResolvedValue({ count: 1 }),
    findById: vi.fn().mockResolvedValue(requestRow()),
    findMany: vi.fn().mockResolvedValue([]),
    recordAssignment: vi.fn().mockResolvedValue({ count: 1 }),
    recordStart: vi.fn().mockResolvedValue({ count: 1 }),
    recordClosure: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-10T00:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ServiceRequestService(
    repo as unknown as ServiceRequestRepository,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, slaTimer, audit };
}

describe('ServiceRequestService.create (Process 41)', () => {
  it('creates at open, starts + attaches the SLA timer, and writes a CREATE audit row', async () => {
    const { service, repo, slaTimer, audit } = makeService();
    const v = await service.create(
      {
        customerId: 'cust-1',
        requestType: 'certificate',
        detail: 'For the landlord',
      },
      'u-sales',
    );
    expect(v.status).toBe('open');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        requestType: 'certificate',
        raisedByUserId: 'u-sales',
        detail: 'For the landlord',
      }),
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ServiceRequest',
        entityId: 'sr-1',
        workflowName: 'service_request_fulfilment',
      }),
    );
    expect(repo.attachSlaTimer).toHaveBeenCalledWith('sr-1', 'sla-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'ServiceRequest',
      }),
    );
  });

  it('404s an unknown customer before writing anything', async () => {
    const { service, repo } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create({ customerId: 'nope', requestType: 'copy' }, 'u-sales'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('404s an unknown policy and 422s a policy that belongs to another customer', async () => {
    const notFound = makeService({
      repo: { policyCustomerId: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      notFound.service.create(
        { customerId: 'cust-1', requestType: 'copy', policyId: 'pol-x' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const mismatch = makeService({
      repo: { policyCustomerId: vi.fn().mockResolvedValue('cust-2') },
    });
    await expect(
      mismatch.service.create(
        { customerId: 'cust-1', requestType: 'copy', policyId: 'pol-2' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('still returns the request when the SLA timer start fails (best-effort)', async () => {
    const { service, slaTimer, repo, audit } = makeService();
    slaTimer.startTimer.mockRejectedValueOnce(new Error('sla down'));
    const v = await service.create(
      { customerId: 'cust-1', requestType: 'other' },
      'u-sales',
    );
    expect(v.status).toBe('open');
    expect(repo.attachSlaTimer).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE' }),
    );
  });
});

describe('ServiceRequestService.assign (Process 41)', () => {
  it('sets the assignee while open, with an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow())
          .mockResolvedValue(requestRow({ assignedToUserId: 'u-2' })),
      },
    });
    const v = await service.assign('sr-1', 'u-2', 'u-mgr');
    expect(repo.recordAssignment).toHaveBeenCalledWith('sr-1', 'u-2');
    expect(v.assignedToUserId).toBe('u-2');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });

  it('422s reassigning a closed request', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(requestRow({ status: 'fulfilled' })),
      },
    });
    await expect(service.assign('sr-1', 'u-2', 'u-mgr')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('404s an unknown assignee', async () => {
    const { service } = makeService({
      repo: { userExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.assign('sr-1', 'ghost', 'u-mgr'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('0 rows updated with the request now terminal -> 422', async () => {
    const { service } = makeService({
      repo: {
        recordAssignment: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow())
          .mockResolvedValue(requestRow({ status: 'cancelled' })),
      },
    });
    await expect(service.assign('sr-1', 'u-2', 'u-mgr')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('0 rows updated but still non-terminal -> 409 (changed concurrently)', async () => {
    const { service } = makeService({
      repo: {
        recordAssignment: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi.fn().mockResolvedValue(requestRow()),
      },
    });
    await expect(service.assign('sr-1', 'u-2', 'u-mgr')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ServiceRequestService.start (Process 41)', () => {
  it('open -> in_progress with an UPDATE audit row', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow())
          .mockResolvedValue(requestRow({ status: 'in_progress' })),
      },
    });
    const v = await service.start('sr-1', 'u-sales');
    expect(repo.recordStart).toHaveBeenCalledWith('sr-1');
    expect(v.status).toBe('in_progress');
  });

  it('is idempotent on an already-in-progress request', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(requestRow({ status: 'in_progress' })),
      },
    });
    const v = await service.start('sr-1', 'u-sales');
    expect(v.status).toBe('in_progress');
    expect(repo.recordStart).not.toHaveBeenCalled();
  });

  it('409s a status that changed concurrently (0 rows, not now in_progress)', async () => {
    const { service } = makeService({
      repo: {
        recordStart: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow())
          .mockResolvedValue(requestRow({ status: 'cancelled' })),
      },
    });
    await expect(service.start('sr-1', 'u-sales')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('422s starting an already-terminal request (not the 409 assertTransition would give)', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(requestRow({ status: 'fulfilled' })),
      },
    });
    await expect(service.start('sr-1', 'u-sales')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repo.recordStart).not.toHaveBeenCalled();
  });
});

describe('ServiceRequestService.fulfil / cancel (Process 41)', () => {
  const NOTE = 'Certificate issued and emailed to the customer.';

  it('in_progress -> fulfilled: stamps closedAt + fulfilledByUserId, resolves the SLA, UPDATE audit', async () => {
    const { service, repo, slaTimer, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow({ status: 'in_progress' }))
          .mockResolvedValue(
            requestRow({
              status: 'fulfilled',
              fulfilledByUserId: 'u-sales',
              outcomeNote: NOTE,
              slaTimer: null,
              closedAt: new Date('2026-09-06T00:00:00.000Z'),
            }),
          ),
      },
    });
    const v = await service.fulfil('sr-1', { outcomeNote: NOTE }, 'u-sales');
    expect(repo.recordClosure).toHaveBeenCalledWith(
      'sr-1',
      expect.objectContaining({
        toStatus: 'fulfilled',
        outcomeNote: NOTE,
        fulfilledByUserId: 'u-sales',
      }),
    );
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ServiceRequest',
        entityId: 'sr-1',
        workflowName: 'service_request_fulfilment',
      }),
    );
    expect(v.status).toBe('fulfilled');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });

  it('cancel with no fulfilledByUserId; resolves the SLA', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow())
          .mockResolvedValue(
            requestRow({
              status: 'cancelled',
              outcomeNote: 'Duplicate.',
              slaTimer: null,
            }),
          ),
      },
    });
    await service.cancel('sr-1', { outcomeNote: 'Duplicate.' }, 'u-sales');
    const arg = repo.recordClosure.mock.calls[0]?.[1] as {
      toStatus: string;
      fulfilledByUserId: string | null;
    };
    expect(arg.toStatus).toBe('cancelled');
    expect(arg.fulfilledByUserId).toBeNull();
  });

  it('is idempotent on a re-fulfil with the same note; 409 on a different note', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          requestRow({
            status: 'fulfilled',
            outcomeNote: NOTE,
            slaTimer: null,
          }),
        ),
      },
    });
    const v = await service.fulfil('sr-1', { outcomeNote: NOTE }, 'u-sales');
    expect(v.status).toBe('fulfilled');
    await expect(
      service.fulfil(
        'sr-1',
        { outcomeNote: 'something else entirely' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('422s fulfilling a request that is already cancelled', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(requestRow({ status: 'cancelled' })),
      },
    });
    await expect(
      service.fulfil('sr-1', { outcomeNote: NOTE }, 'u-sales'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('404s an unknown request', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.fulfil('nope', { outcomeNote: NOTE }, 'u-sales'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('0 rows updated but the request landed on the same status + note -> idempotent 200', async () => {
    const { service, slaTimer } = makeService({
      repo: {
        recordClosure: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow({ status: 'in_progress' }))
          .mockResolvedValue(
            requestRow({
              status: 'fulfilled',
              outcomeNote: NOTE,
              slaTimer: null,
            }),
          ),
      },
    });
    const v = await service.fulfil('sr-1', { outcomeNote: NOTE }, 'u-sales');
    expect(v.status).toBe('fulfilled');
    // A no-op closure does not re-resolve the timer.
    expect(slaTimer.resolve).not.toHaveBeenCalled();
  });

  it('0 rows updated and the request landed elsewhere -> 409', async () => {
    const { service } = makeService({
      repo: {
        recordClosure: vi.fn().mockResolvedValue({ count: 0 }),
        findById: vi
          .fn()
          .mockResolvedValueOnce(requestRow({ status: 'in_progress' }))
          .mockResolvedValue(requestRow({ status: 'in_progress' })),
      },
    });
    await expect(
      service.fulfil('sr-1', { outcomeNote: NOTE }, 'u-sales'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
