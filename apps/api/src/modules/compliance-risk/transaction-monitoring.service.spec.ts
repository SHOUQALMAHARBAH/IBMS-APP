import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import type { TransactionMonitoringAlertRepository } from '../../repositories/transaction-monitoring-alert.repository';
import type { AuditService } from '../audit/audit.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
}

const alertRow = (over: Record<string, unknown> = {}) => ({
  id: 'alert-1',
  customerId: 'cust-1',
  patternType: 'large_premium_payment',
  detailText: 'detail',
  sourceEntityType: 'Receipt',
  sourceEntityId: 'receipt-1',
  detectedAt: new Date('2026-09-04T09:00:00.000Z'),
  escalatedToSuspiciousActivity: false,
  escalatedAt: null,
  reportedToAuthorityAt: null,
  status: 'open',
  classification: 'HIGHLY_CONFIDENTIAL',
  ...over,
});

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(alertRow()),
    findById: vi.fn().mockResolvedValue(alertRow()),
    findMany: vi.fn().mockResolvedValue([]),
    findExistingSourceAlertKeys: vi.fn().mockResolvedValue([]),
    hasOpenAggregateAlert: vi.fn().mockResolvedValue(false),
    findReceiptsForSweep: vi.fn().mockResolvedValue([]),
    findCancellationsSince: vi.fn().mockResolvedValue([]),
    findRefundsSince: vi.fn().mockResolvedValue([]),
    recordEscalation: vi.fn().mockResolvedValue({ count: 1 }),
    recordReportToAuthority: vi.fn().mockResolvedValue({ count: 1 }),
    recordClosure: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new TransactionMonitoringService(
    repo as unknown as TransactionMonitoringAlertRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('TransactionMonitoringService.create — manual log (Process 48)', () => {
  it('404s when an explicit customerId does not exist', async () => {
    const { service } = makeService({
      repo: { customerExists: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      service.create({ customerId: 'nope', patternType: 'other' }, 'u-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates without a customerId (schema allows a customer-less alert)', async () => {
    const { service, repo } = makeService();
    await service.create({ patternType: 'other', detailText: 'note' }, 'u-1');
    expect(repo.customerExists).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith({
      customerId: null,
      patternType: 'other',
      detailText: 'note',
    });
  });

  it('creates and writes a CREATE audit row that excludes detailText', async () => {
    const { service, audit } = makeService();
    const v = await service.create(
      {
        customerId: 'cust-1',
        patternType: 'large_premium_payment',
        detailText: 'secret payer name',
      },
      'u-compliance',
    );
    expect(v.id).toBe('alert-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'TransactionMonitoringAlert',
        entityId: 'alert-1',
        isSensitiveDataAccess: true,
      }),
    );
    const auditCall = audit.record.mock.calls[0][0] as {
      afterValue: Record<string, unknown>;
    };
    expect(auditCall.afterValue).not.toHaveProperty('detailText');
  });

  it('maps a P2002 (an already-open aggregate alert for this customer/pattern) to a 409, not a raw 500 — the BLOCKER fix', async () => {
    const { service, audit } = makeService({
      repo: {
        create: vi.fn().mockRejectedValue(p2002()),
      },
    });
    await expect(
      service.create(
        { customerId: 'cust-1', patternType: 'frequent_cancellations' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('TransactionMonitoringService.runSweep — receipt-scoped patterns (Process 48)', () => {
  const receipt = (over: Record<string, unknown> = {}) => ({
    id: 'receipt-1',
    invoice: {
      id: 'invoice-1',
      customerId: 'cust-1',
      premiumAmount: new Prisma.Decimal('5000.000'),
    },
    paymentChannel: null,
    ...over,
  });

  it('creates an alert for a large premium payment', async () => {
    const { service, repo } = makeService({
      repo: {
        findReceiptsForSweep: vi.fn().mockResolvedValue([
          receipt({
            invoice: {
              id: 'invoice-1',
              customerId: 'cust-1',
              premiumAmount: new Prisma.Decimal('20000.000'),
            },
          }),
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        patternType: 'large_premium_payment',
        sourceEntityId: 'receipt-1',
      }),
    );
  });

  it('creates an alert for a third-party payment source', async () => {
    const { service, repo } = makeService({
      repo: {
        findReceiptsForSweep: vi.fn().mockResolvedValue([
          receipt({
            paymentChannel: { ownerType: 'customer', customerId: 'cust-2' },
          }),
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ patternType: 'third_party_payment_source' }),
    );
  });

  it('an ordinary small, own-channel receipt creates nothing', async () => {
    const { service, repo } = makeService({
      repo: { findReceiptsForSweep: vi.fn().mockResolvedValue([receipt()]) },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(0);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('skips a Receipt already flagged for this pattern (pre-check)', async () => {
    const { service, repo } = makeService({
      repo: {
        findReceiptsForSweep: vi.fn().mockResolvedValue([
          receipt({
            invoice: {
              id: 'invoice-1',
              customerId: 'cust-1',
              premiumAmount: new Prisma.Decimal('20000.000'),
            },
          }),
        ]),
        findExistingSourceAlertKeys: vi.fn().mockResolvedValue([
          {
            patternType: 'large_premium_payment',
            sourceEntityId: 'receipt-1',
          },
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(0);
    expect(result.skippedExisting).toBe(1);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('a concurrent sweep (P2002 on create) counts as skippedExisting, not failed', async () => {
    const { service } = makeService({
      repo: {
        findReceiptsForSweep: vi.fn().mockResolvedValue([
          receipt({
            invoice: {
              id: 'invoice-1',
              customerId: 'cust-1',
              premiumAmount: new Prisma.Decimal('20000.000'),
            },
          }),
        ]),
        create: vi.fn().mockRejectedValue(p2002()),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.skippedExisting).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('a genuine error counts as failed and does not abandon the rest of the sweep', async () => {
    const { service } = makeService({
      repo: {
        findReceiptsForSweep: vi.fn().mockResolvedValue([
          receipt({
            id: 'bad-receipt',
            invoice: {
              id: 'invoice-bad',
              customerId: 'cust-1',
              premiumAmount: new Prisma.Decimal('20000.000'),
            },
          }),
          receipt({
            id: 'good-receipt',
            invoice: {
              id: 'invoice-good',
              customerId: 'cust-2',
              premiumAmount: new Prisma.Decimal('20000.000'),
            },
          }),
        ]),
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error('db blip'))
          .mockResolvedValueOnce(alertRow({ id: 'alert-2' })),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.failed).toBe(1);
    expect(result.created).toBe(1);
  });

  it('both patterns on the same receipt each create their own alert', async () => {
    const { service, repo } = makeService({
      repo: {
        findReceiptsForSweep: vi.fn().mockResolvedValue([
          receipt({
            invoice: {
              id: 'invoice-1',
              customerId: 'cust-1',
              premiumAmount: new Prisma.Decimal('99999.000'),
            },
            paymentChannel: { ownerType: 'customer', customerId: 'cust-2' },
          }),
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(2);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });
});

describe('TransactionMonitoringService.runSweep — aggregate patterns (Process 48)', () => {
  it('opens frequent_cancellations once the count clears the threshold', async () => {
    const { service, repo } = makeService({
      repo: {
        findCancellationsSince: vi.fn().mockResolvedValue([
          { customerId: 'cust-1', createdAt: new Date() },
          { customerId: 'cust-1', createdAt: new Date() },
          { customerId: 'cust-1', createdAt: new Date() },
        ]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        patternType: 'frequent_cancellations',
        customerId: 'cust-1',
      }),
    );
  });

  it('below the threshold — nothing created', async () => {
    const { service, repo } = makeService({
      repo: {
        findCancellationsSince: vi
          .fn()
          .mockResolvedValue([{ customerId: 'cust-1', createdAt: new Date() }]),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(0);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('an already-open aggregate alert for this customer/pattern suppresses a new one', async () => {
    const { service, repo } = makeService({
      repo: {
        findRefundsSince: vi.fn().mockResolvedValue([
          { customerId: 'cust-1', createdAt: new Date() },
          { customerId: 'cust-1', createdAt: new Date() },
          { customerId: 'cust-1', createdAt: new Date() },
        ]),
        hasOpenAggregateAlert: vi.fn().mockResolvedValue(true),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(0);
    expect(result.skippedExisting).toBe(1);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('a concurrent open (P2002 on the aggregate create) counts as skippedExisting', async () => {
    const { service } = makeService({
      repo: {
        findRefundsSince: vi.fn().mockResolvedValue([
          { customerId: 'cust-1', createdAt: new Date() },
          { customerId: 'cust-1', createdAt: new Date() },
          { customerId: 'cust-1', createdAt: new Date() },
        ]),
        create: vi.fn().mockRejectedValue(p2002()),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.skippedExisting).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('cancellations and refunds are independent — a customer can be flagged for both', async () => {
    const threeEvents = [
      { customerId: 'cust-1', createdAt: new Date() },
      { customerId: 'cust-1', createdAt: new Date() },
      { customerId: 'cust-1', createdAt: new Date() },
    ];
    const { service, repo } = makeService({
      repo: {
        findCancellationsSince: vi.fn().mockResolvedValue(threeEvents),
        findRefundsSince: vi.fn().mockResolvedValue(threeEvents),
      },
    });
    const result = await service.runSweep('system-user');
    expect(result.created).toBe(2);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ patternType: 'frequent_cancellations' }),
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ patternType: 'frequent_refunds' }),
    );
  });
});

describe('TransactionMonitoringService.escalate (Process 48)', () => {
  it('404s for an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.escalate('nope', 'u-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cannot escalate a closed, never-escalated alert', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          alertRow({
            status: 'closed',
            escalatedToSuspiciousActivity: false,
          }),
        ),
      },
    });
    await expect(service.escalate('alert-1', 'u-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('is idempotent on an alert that was escalated and has SINCE been closed — a MINOR fix (the escalation flag is checked before the status guard, not after)', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            alertRow({ status: 'closed', escalatedToSuspiciousActivity: true }),
          ),
      },
    });
    const v = await service.escalate('alert-1', 'u-1');
    expect(v.status).toBe('closed');
    expect(v.escalatedToSuspiciousActivity).toBe(true);
    expect(repo.recordEscalation).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('escalates and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            alertRow({ escalatedToSuspiciousActivity: false }),
          )
          .mockResolvedValueOnce(
            alertRow({
              escalatedToSuspiciousActivity: true,
              escalatedAt: new Date(),
            }),
          ),
      },
    });
    const v = await service.escalate('alert-1', 'u-compliance');
    expect(v.escalatedToSuspiciousActivity).toBe(true);
    expect(repo.recordEscalation).toHaveBeenCalledWith(
      'alert-1',
      expect.any(Date),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'TransactionMonitoringAlert',
      }),
    );
  });

  it('is idempotent when already escalated (no repo write, no audit)', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(alertRow({ escalatedToSuspiciousActivity: true })),
      },
    });
    const v = await service.escalate('alert-1', 'u-1');
    expect(v.escalatedToSuspiciousActivity).toBe(true);
    expect(repo.recordEscalation).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('TransactionMonitoringService.reportToAuthority (Process 48)', () => {
  it('refuses to report an alert that was never escalated', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            alertRow({ escalatedToSuspiciousActivity: false }),
          ),
      },
    });
    await expect(
      service.reportToAuthority('alert-1', 'u-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('reports and writes an UPDATE audit row', async () => {
    const escalated = alertRow({
      escalatedToSuspiciousActivity: true,
      escalatedAt: new Date(),
    });
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(escalated)
          .mockResolvedValueOnce({
            ...escalated,
            reportedToAuthorityAt: new Date(),
          }),
      },
    });
    const v = await service.reportToAuthority('alert-1', 'u-compliance');
    expect(v.reportedToAuthorityAt).not.toBeNull();
    expect(repo.recordReportToAuthority).toHaveBeenCalledWith(
      'alert-1',
      expect.any(Date),
    );
    expect(audit.record).toHaveBeenCalled();
  });

  it('is idempotent when already reported', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          alertRow({
            escalatedToSuspiciousActivity: true,
            reportedToAuthorityAt: new Date(),
          }),
        ),
      },
    });
    const v = await service.reportToAuthority('alert-1', 'u-1');
    expect(v.reportedToAuthorityAt).not.toBeNull();
    expect(repo.recordReportToAuthority).not.toHaveBeenCalled();
  });
});

describe('TransactionMonitoringService.close (Process 48)', () => {
  it('closes and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(alertRow({ status: 'open' }))
          .mockResolvedValueOnce(alertRow({ status: 'closed' })),
      },
    });
    const v = await service.close('alert-1', 'u-compliance');
    expect(v.status).toBe('closed');
    expect(repo.recordClosure).toHaveBeenCalledWith('alert-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'TransactionMonitoringAlert',
      }),
    );
  });

  it('is idempotent when already closed', async () => {
    const { service, repo, audit } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(alertRow({ status: 'closed' })),
      },
    });
    const v = await service.close('alert-1', 'u-1');
    expect(v.status).toBe('closed');
    expect(repo.recordClosure).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s for an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.close('nope', 'u-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TransactionMonitoringService reads (Process 48)', () => {
  it('get() 404s for an unknown id', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope', 'u-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('get() writes a READ audit row (HIGHLY_CONFIDENTIAL — the Claim/Crm precedent, not the Confidential-tier no-audit one)', async () => {
    const { service, audit } = makeService();
    await service.get('alert-1', 'u-compliance');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'TransactionMonitoringAlert',
        entityId: 'alert-1',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('list() maps rows to views and passes filters through', async () => {
    const { service, repo } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue([alertRow()]) },
    });
    const rows = await service.list(
      { customerId: 'cust-1', status: 'open' },
      'u-1',
    );
    expect(rows).toHaveLength(1);
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', status: 'open' }),
      5000,
    );
  });

  it('list() writes a READ audit row, isSensitiveDataAccess only when rows were returned', async () => {
    const { service, audit } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await service.list({}, 'u-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'TransactionMonitoringAlert',
        entityId: 'list',
        isSensitiveDataAccess: false,
      }),
    );
  });
});
