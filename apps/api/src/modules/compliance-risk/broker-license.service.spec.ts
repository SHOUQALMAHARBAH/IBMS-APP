import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { BrokerLicenseService } from './broker-license.service';
import type { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import type { AuditService } from '../audit/audit.service';
import type { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import type { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeDeps(existing: unknown = null) {
  const state = { row: existing };

  const findCurrent = vi
    .fn()
    .mockImplementation(() => Promise.resolve(state.row));
  const create = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) => {
      state.row = { id: 'the-broker-license', status: 'active', ...input };
      return Promise.resolve(state.row);
    });
  const renew = vi.fn().mockImplementation((input: Record<string, unknown>) => {
    if (state.row) {
      state.row = { ...state.row, ...input, status: 'active' };
    }
    return Promise.resolve({ count: state.row ? 1 : 0 });
  });
  const markLapsed = vi.fn().mockImplementation(() => {
    if (state.row && (state.row as { status: string }).status === 'active') {
      state.row = { ...state.row, status: 'lapsed' };
      return Promise.resolve({ count: 1 });
    }
    return Promise.resolve({ count: 0 });
  });
  const repo = {
    findCurrent,
    create,
    renew,
    markLapsed,
  } as unknown as BrokerLicenseRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new BrokerLicenseService(repo, audit),
    mocks: { findCurrent, create, renew, markLapsed, record },
    state,
  };
}

const CREATE_DTO: CreateBrokerLicenseDto = {
  licenseNumber: 'CBJ-2026-001',
  scopeOfAuthorization: 'General insurance brokerage',
  issuedAt: '2026-01-01',
  expiresAt: '2027-01-01',
};

describe('BrokerLicenseService (Process 51)', () => {
  describe('create', () => {
    it('creates the singleton and audits CREATE', async () => {
      const { service, mocks } = makeDeps();
      const view = await service.create(CREATE_DTO, 'compliance-1');
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ licenseNumber: 'CBJ-2026-001' }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'BrokerLicense',
        }),
      );
      expect(view.status).toBe('active');
      expect(view.isCurrentlyLapsed).toBe(false);
    });

    it('409s when a record already exists', async () => {
      const { service } = makeDeps({
        id: 'the-broker-license',
        licenseNumber: 'CBJ-OLD',
        scopeOfAuthorization: null,
        issuedAt: null,
        expiresAt: new Date('2027-01-01'),
        status: 'active',
      });
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        ConflictException,
      );
    });

    // A @code-reviewer MAJOR: two concurrent creates can both pass the
    // findCurrent() === null pre-check before either has written the row —
    // the fixed-id primary key stops a second row from ever existing, but
    // the resulting P2002 must map to the same clean 409, not an unhandled
    // 500.
    it('409s (not a raw 500) when repo.create() races and P2002s after the pre-check passed', async () => {
      const { service, mocks } = makeDeps();
      mocks.create.mockRejectedValueOnce(p2002());
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('a non-P2002 create failure still propagates (not silently mapped to 409)', async () => {
      const { service, mocks } = makeDeps();
      mocks.create.mockRejectedValueOnce(new Error('DB is down'));
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        'DB is down',
      );
    });
  });

  describe('renew', () => {
    it('404s when no record exists yet', async () => {
      const { service } = makeDeps();
      const dto: RenewBrokerLicenseDto = { ...CREATE_DTO };
      await expect(service.renew(dto, 'compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates particulars and resets status to active, and audits UPDATE', async () => {
      const { service, mocks } = makeDeps({
        id: 'the-broker-license',
        licenseNumber: 'CBJ-OLD',
        scopeOfAuthorization: null,
        issuedAt: null,
        expiresAt: new Date('2026-01-01'),
        status: 'lapsed',
      });
      const view = await service.renew(
        { ...CREATE_DTO, licenseNumber: 'CBJ-2027-002' },
        'compliance-1',
      );
      expect(view.licenseNumber).toBe('CBJ-2027-002');
      expect(view.status).toBe('active');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entityType: 'BrokerLicense',
        }),
      );
    });
  });

  describe('markLapsed', () => {
    it('404s when no record exists yet', async () => {
      const { service } = makeDeps();
      await expect(service.markLapsed('compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('flips an active license to lapsed and audits UPDATE', async () => {
      const { service, mocks } = makeDeps({
        id: 'the-broker-license',
        licenseNumber: 'CBJ-2026-001',
        scopeOfAuthorization: null,
        issuedAt: null,
        expiresAt: new Date('2027-01-01'),
        status: 'active',
      });
      const view = await service.markLapsed('compliance-1');
      expect(view.status).toBe('lapsed');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('is idempotent on an already-lapsed license (no duplicate audit row)', async () => {
      const { service, mocks } = makeDeps({
        id: 'the-broker-license',
        licenseNumber: 'CBJ-2026-001',
        scopeOfAuthorization: null,
        issuedAt: null,
        expiresAt: new Date('2027-01-01'),
        status: 'lapsed',
      });
      const view = await service.markLapsed('compliance-1');
      expect(view.status).toBe('lapsed');
      expect(mocks.record).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('404s when no record exists yet', async () => {
      const { service } = makeDeps();
      await expect(service.get()).rejects.toThrow(NotFoundException);
    });

    it('returns the live-derived view', async () => {
      const { service } = makeDeps({
        id: 'the-broker-license',
        licenseNumber: 'CBJ-2026-001',
        scopeOfAuthorization: null,
        issuedAt: null,
        expiresAt: new Date('2020-01-01'),
        status: 'active',
      });
      const view = await service.get();
      expect(view.isCurrentlyLapsed).toBe(true);
    });
  });
});
