import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { EmployeePerformanceRecord } from '@ibms/db';
import { EmployeePerformanceService } from './employee-performance.service';
import type {
  EmployeePerformanceRecordInput,
  EmployeePerformanceRepository,
} from '../../repositories/employee-performance.repository';
import type { AuditService } from '../audit/audit.service';
import type { PeriodWindow } from './employee-performance.config';

const PERIOD: PeriodWindow = {
  periodLabel: '2026-08',
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
};

const RECORD_ROW: EmployeePerformanceRecord = {
  id: 'record-1',
  employeeId: 'employee-1',
  periodLabel: '2026-08',
  newClients: 0,
  premiumWritten: new Prisma.Decimal('0'),
  commissionEarned: new Prisma.Decimal('0'),
  renewalRatePercent: null,
  crossSellRatePercent: null,
};

function upsertedData(repo: {
  upsertRecord: ReturnType<typeof vi.fn>;
}): EmployeePerformanceRecordInput {
  return repo.upsertRecord.mock.calls[0][2] as EmployeePerformanceRecordInput;
}

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    listEmployeeUserPairs: vi
      .fn()
      .mockResolvedValue([{ employeeId: 'employee-1', userId: 'user-1' }]),
    findUserIdForEmployee: vi.fn().mockResolvedValue('user-1'),
    countNewClients: vi.fn().mockResolvedValue(0),
    sumPremiumWritten: vi.fn().mockResolvedValue(null),
    sumCommissionEarned: vi.fn().mockResolvedValue(null),
    countRenewalOutcomes: vi.fn().mockResolvedValue({ total: 0, succeeded: 0 }),
    countCrossSellOutcomes: vi
      .fn()
      .mockResolvedValue({ total: 0, succeeded: 0 }),
    upsertRecord: vi
      .fn()
      .mockResolvedValue({ row: RECORD_ROW, wasCreated: true }),
    findMany: vi.fn().mockResolvedValue([RECORD_ROW]),
    findLatest: vi.fn().mockResolvedValue(RECORD_ROW),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new EmployeePerformanceService(
    repo as unknown as EmployeePerformanceRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('EmployeePerformanceService.computeRecordForEmployee', () => {
  it('404s when the employee has no linked User account', async () => {
    const { service } = makeService({
      repo: { findUserIdForEmployee: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('defaults newClients/premium/commission to 0 and both rates to null with no activity', async () => {
    const { service, repo } = makeService();
    await service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    const data = upsertedData(repo);
    expect(data.newClients).toBe(0);
    expect(data.premiumWritten.toString()).toBe('0');
    expect(data.commissionEarned.toString()).toBe('0');
    expect(data.renewalRatePercent).toBeNull();
    expect(data.crossSellRatePercent).toBeNull();
  });

  it('counts new clients via the linked userId', async () => {
    const { service, repo } = makeService({
      repo: { countNewClients: vi.fn().mockResolvedValue(4) },
    });
    await service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    expect(repo.countNewClients).toHaveBeenCalledWith(
      'user-1',
      PERIOD.periodStart,
      PERIOD.periodEnd,
    );
    const data = upsertedData(repo);
    expect(data.newClients).toBe(4);
  });

  it('sums premium and commission when there is real activity', async () => {
    const { service, repo } = makeService({
      repo: {
        sumPremiumWritten: vi
          .fn()
          .mockResolvedValue(new Prisma.Decimal('50000.000')),
        sumCommissionEarned: vi
          .fn()
          .mockResolvedValue(new Prisma.Decimal('7500.000')),
      },
    });
    await service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    const data = upsertedData(repo);
    expect(data.premiumWritten.toString()).toBe('50000');
    expect(data.commissionEarned.toString()).toBe('7500');
  });

  it('computes a real renewal rate when outcomes exist', async () => {
    const { service, repo } = makeService({
      repo: {
        countRenewalOutcomes: vi
          .fn()
          .mockResolvedValue({ total: 4, succeeded: 3 }),
      },
    });
    await service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    const data = upsertedData(repo);
    expect(data.renewalRatePercent?.toString()).toBe('75');
  });

  it('computes a real cross-sell rate when outcomes exist', async () => {
    const { service, repo } = makeService({
      repo: {
        countCrossSellOutcomes: vi
          .fn()
          .mockResolvedValue({ total: 5, succeeded: 2 }),
      },
    });
    await service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    const data = upsertedData(repo);
    expect(data.crossSellRatePercent?.toString()).toBe('40');
  });

  it('writes a CREATE audit row on first compute and UPDATE on a recompute', async () => {
    const { service, audit } = makeService();
    await service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'EmployeePerformanceRecord',
      }),
    );

    const { service: service2, audit: audit2 } = makeService({
      repo: {
        upsertRecord: vi
          .fn()
          .mockResolvedValue({ row: RECORD_ROW, wasCreated: false }),
      },
    });
    await service2.computeRecordForEmployee('employee-1', PERIOD, 'actor-1');
    expect(audit2.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'EmployeePerformanceRecord',
      }),
    );
  });

  it('does not fail the compute if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.computeRecordForEmployee('employee-1', PERIOD, 'actor-1'),
    ).resolves.toBeDefined();
  });
});

describe('EmployeePerformanceService.computeRecords', () => {
  it('scores every linked employee, isolating one failure from the rest', async () => {
    const { service, repo } = makeService({
      repo: {
        listEmployeeUserPairs: vi.fn().mockResolvedValue([
          { employeeId: 'employee-1', userId: 'user-1' },
          { employeeId: 'employee-2', userId: 'user-2' },
        ]),
        upsertRecord: vi
          .fn()
          .mockImplementationOnce(() => Promise.reject(new Error('db hiccup')))
          .mockImplementationOnce(() =>
            Promise.resolve({ row: RECORD_ROW, wasCreated: true }),
          ),
      },
    });
    const result = await service.computeRecords(PERIOD, 'actor-1');
    expect(result).toEqual({
      periodLabel: '2026-08',
      employeesComputed: 1,
      employeesFailed: 1,
    });
    expect(repo.upsertRecord).toHaveBeenCalledTimes(2);
  });
});

describe('EmployeePerformanceService.list / latest', () => {
  it('list() passes filters through and derives the view', async () => {
    const { service, repo } = makeService();
    const rows = await service.list({ employeeId: 'employee-1' });
    expect(repo.findMany).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      periodLabel: undefined,
      branchId: undefined,
    });
    expect(rows[0].id).toBe('record-1');
  });

  it('list() forwards branchId — Part E Insurer & Employee Performance Dashboard addition', async () => {
    const { service, repo } = makeService();
    await service.list({ branchId: 'branch-1' });
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1' }),
    );
  });

  it('latest() 404s when no record has ever been computed', async () => {
    const { service } = makeService({
      repo: { findLatest: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.latest('employee-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('EmployeePerformanceService.resolvePeriodFromDto', () => {
  it('defaults to the previous UTC calendar month when every period field is omitted', () => {
    const { service } = makeService();
    const period = service.resolvePeriodFromDto({ employeeId: 'employee-1' });
    expect(period.periodLabel).toMatch(/^\d{4}-\d{2}$/);
  });

  it('accepts an explicit period when all three fields are supplied', () => {
    const { service } = makeService();
    const period = service.resolvePeriodFromDto({
      employeeId: 'employee-1',
      periodLabel: '2026-01',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
    });
    expect(period.periodLabel).toBe('2026-01');
  });

  it('422s a partial override', () => {
    const { service } = makeService();
    expect(() =>
      service.resolvePeriodFromDto({
        employeeId: 'employee-1',
        periodLabel: '2026-01',
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('422s periodEnd at or before periodStart', () => {
    const { service } = makeService();
    expect(() =>
      service.resolvePeriodFromDto({
        employeeId: 'employee-1',
        periodLabel: '2026-01',
        periodStart: '2026-02-01',
        periodEnd: '2026-01-01',
      }),
    ).toThrow(UnprocessableEntityException);
  });
});
