import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { BrokerLicense } from '@ibms/db';
import { BrokerLicenseService } from './broker-license.service';
import type { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import type { AuditService } from '../audit/audit.service';
import type { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';

/**
 * Module 0 item (c) rewrote this spec rather than patching it, because the repository it mocks
 * changed shape: every method used to address one globally-keyed row (`findCurrent`, and a `renew`
 * that was an `updateMany` over it), and a licence is now a SERIES OF TERMS per office.
 *
 * The double below is a real in-memory series, not per-method `mockResolvedValue`s. With a
 * singleton the two were equivalent; with a series they are not — "renew appends rather than
 * overwrites" is a claim ABOUT the collection, and a mock returning a fixed row cannot fail it.
 */

const CERT = 'doc-certificate-1';

function term(overrides: Partial<BrokerLicense> = {}): BrokerLicense {
  return {
    id: 'term-1',
    organizationId: 'org-1',
    licenseNumber: 'CBJ-2026-001',
    scopeOfAuthorization: 'General insurance brokerage',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2028-12-31T00:00:00.000Z'),
    status: 'active',
    certificateDocumentId: CERT,
    renewalRequestedAt: null,
    ...overrides,
  };
}

function makeDeps(initial: BrokerLicense[] = []) {
  const terms: BrokerLicense[] = [...initial];
  let created = 0;

  const findTerms = vi.fn(() =>
    Promise.resolve(
      [...terms].sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime()),
    ),
  );
  const findTermById = vi.fn((id: string) =>
    Promise.resolve(terms.find((t) => t.id === id) ?? null),
  );
  const createTerm = vi.fn(
    (input: {
      licenseNumber: string;
      scopeOfAuthorization: string | null;
      issuedAt: Date | null;
      expiresAt: Date;
      certificate: {
        fileName: string;
        storageRef: string;
        uploadedByUserId: string;
      };
    }) => {
      // The real table has @@unique([organizationId, licenseNumber, expiresAt]); the double
      // enforces it so the service's P2002 mapping is reachable here at all.
      const clash = terms.some(
        (t) =>
          t.licenseNumber === input.licenseNumber &&
          t.expiresAt.getTime() === input.expiresAt.getTime(),
      );
      if (clash) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      }
      created += 1;
      const row = term({
        id: `term-new-${created}`,
        licenseNumber: input.licenseNumber,
        scopeOfAuthorization: input.scopeOfAuthorization,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        status: 'active',
        certificateDocumentId: `doc-${created}`,
      });
      terms.push(row);
      return Promise.resolve(row);
    },
  );
  const recordRenewalRequest = vi.fn((id: string, at: Date) => {
    const t = terms.find((x) => x.id === id && x.renewalRequestedAt === null);
    if (!t) return Promise.resolve({ count: 0 });
    t.renewalRequestedAt = at;
    return Promise.resolve({ count: 1 });
  });
  const markLapsed = vi.fn((id: string) => {
    const t = terms.find((x) => x.id === id && x.status === 'active');
    if (!t) return Promise.resolve({ count: 0 });
    t.status = 'lapsed';
    return Promise.resolve({ count: 1 });
  });

  const repo = {
    findTerms,
    findTermById,
    createTerm,
    recordRenewalRequest,
    markLapsed,
  } as unknown as BrokerLicenseRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new BrokerLicenseService(repo, audit),
    mocks: { findTerms, createTerm, recordRenewalRequest, markLapsed, record },
    terms,
  };
}

const CREATE_DTO: CreateBrokerLicenseDto = {
  licenseNumber: 'CBJ-2026-001',
  scopeOfAuthorization: 'General insurance brokerage',
  issuedAt: '2026-01-01',
  expiresAt: '2028-12-31',
  certificateFileName: 'cbj-licence-2026.pdf',
  certificateStorageRef: 'licences/cbj-licence-2026.pdf',
};

describe('BrokerLicenseService — a series of terms (Module 0 item c)', () => {
  describe('create', () => {
    it('records the first term, with its certificate, and audits CREATE', async () => {
      const { service, mocks, terms } = makeDeps();
      const view = await service.create(CREATE_DTO, 'compliance-1');

      expect(terms).toHaveLength(1);
      expect(view.licenseNumber).toBe('CBJ-2026-001');
      expect(view.certificateDocumentId).toBeTruthy();
      // The certificate is attributed to the actor, not to nobody.
      expect(mocks.createTerm.mock.calls[0]?.[0].certificate).toMatchObject({
        fileName: 'cbj-licence-2026.pdf',
        uploadedByUserId: 'compliance-1',
      });
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'BrokerLicense',
        }),
      );
    });

    it('409s when THIS OFFICE already holds a term', async () => {
      const { service } = makeDeps([term()]);
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s (not a raw 500) when the same term is recorded twice', async () => {
      const { service } = makeDeps();
      await service.create(CREATE_DTO, 'compliance-1');
      // Same number and expiry -> the unique index. Reached through `renew`, because `create`
      // itself stops at the office-already-holds-one check one step earlier.
      await expect(service.renew(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('a non-P2002 failure still propagates rather than being mapped to 409', async () => {
      const { service, mocks } = makeDeps();
      mocks.createTerm.mockRejectedValueOnce(new Error('connection reset'));
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        'connection reset',
      );
    });
  });

  describe('renew', () => {
    it('404s when the office holds no term yet', async () => {
      const { service } = makeDeps();
      await expect(service.renew(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('APPENDS a term and leaves the previous one intact', async () => {
      const previous = term({
        id: 'term-old',
        expiresAt: new Date('2025-12-31T00:00:00.000Z'),
        status: 'lapsed',
      });
      const { service, terms } = makeDeps([previous]);

      await service.renew(CREATE_DTO, 'compliance-1');

      // The claim that matters, and the one the old `updateMany` could not satisfy: the office can
      // still show a regulator what it held last period.
      expect(terms).toHaveLength(2);
      const old = terms.find((t) => t.id === 'term-old');
      expect(old?.expiresAt.toISOString()).toBe('2025-12-31T00:00:00.000Z');
      expect(old?.status).toBe('lapsed');

      const { current, terms: series } = await service.get();
      expect(series).toHaveLength(2);
      expect(current?.expiresAt).toBe('2028-12-31T00:00:00.000Z');
    });
  });

  describe('recordRenewalRequest', () => {
    it('404s when the office holds no term yet', async () => {
      const { service } = makeDeps();
      await expect(
        service.recordRenewalRequest({}, 'compliance-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('records the filing date against the current term and audits it', async () => {
      const { service, mocks } = makeDeps([term()]);
      const view = await service.recordRenewalRequest(
        { requestedAt: '2028-11-01' },
        'compliance-1',
      );
      expect(view.renewalRequestedAt).toBe('2028-11-01T00:00:00.000Z');
      // Whether a human chose the date is recorded, because that is what makes a backdated
      // filing answerable rather than invisible.
      // Read off the recorded call rather than nesting `expect.objectContaining` inside another:
      // that returns `any`, which this repo's lint refuses as an unsafe assignment — and the value
      // itself is the sharper assertion anyway.
      const recorded = mocks.record.mock.calls[0]?.[0] as {
        action: string;
        afterValue: Record<string, unknown>;
      };
      expect(recorded.action).toBe('UPDATE');
      expect(recorded.afterValue.renewalRequestedAtWasSupplied).toBe(true);
    });

    it('defaults to today and says so in the audit row', async () => {
      const { service, mocks } = makeDeps([term()]);
      const view = await service.recordRenewalRequest({}, 'compliance-1');
      expect(view.renewalRequestedAt).toBeTruthy();
      const recorded = mocks.record.mock.calls[0]?.[0] as {
        afterValue: Record<string, unknown>;
      };
      expect(recorded.afterValue.renewalRequestedAtWasSupplied).toBe(false);
    });

    it('409s on a second call rather than moving the filing date', async () => {
      const { service, terms } = makeDeps([term()]);
      await service.recordRenewalRequest({ requestedAt: '2028-11-01' }, 'c-1');
      await expect(
        service.recordRenewalRequest({ requestedAt: '2028-12-20' }, 'c-1'),
      ).rejects.toThrow(ConflictException);
      // Art. 11 lateness is measured from this date, so a second call must not be able to move it
      // from on-time to late or back.
      expect(terms[0]?.renewalRequestedAt?.toISOString()).toBe(
        '2028-11-01T00:00:00.000Z',
      );
    });
  });

  describe('markLapsed', () => {
    it('404s when the office holds no term yet', async () => {
      const { service } = makeDeps();
      await expect(service.markLapsed('compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('flips the current term to lapsed and audits UPDATE', async () => {
      const { service, mocks, terms } = makeDeps([term()]);
      const view = await service.markLapsed('compliance-1');
      expect(view.status).toBe('lapsed');
      expect(terms[0]?.status).toBe('lapsed');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('is idempotent on an already-lapsed term (no duplicate audit row)', async () => {
      const { service, mocks } = makeDeps([term({ status: 'lapsed' })]);
      const view = await service.markLapsed('compliance-1');
      expect(view.status).toBe('lapsed');
      expect(mocks.record).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('REPOINTED: no longer 404s for an office with no licence — it reports the absence', async () => {
      // This test asserted `rejects.toThrow(NotFoundException)` before Module 0 item (c).
      //
      // That was defensible while a licence was one global row somebody had either created or not.
      // It is wrong now for a specific reason: "this office holds no licence" is the state that
      // BLOCKS new business (CBJ Instructions No. 9 of 2026, art. 21/a/9), so the screen must be
      // able to render it. A 404 tells the reader nothing and looks like a broken page.
      const { service } = makeDeps();
      const view = await service.get();
      expect(view.current).toBeNull();
      expect(view.terms).toEqual([]);
    });

    it('returns the live-derived view of the current term', async () => {
      const { service } = makeDeps([
        term({ expiresAt: new Date('2020-01-01'), status: 'active' }),
      ]);
      const view = await service.get();
      expect(view.current?.isCurrentlyLapsed).toBe(true);
    });

    it('picks the LATEST term as current, not the first recorded', async () => {
      const { service } = makeDeps([
        term({ id: 'old', expiresAt: new Date('2025-12-31') }),
        term({ id: 'new', expiresAt: new Date('2028-12-31') }),
      ]);
      const view = await service.get();
      // Between filing a renewal and the old term expiring, an office holds two. The newer one is
      // what decides whether it may practise tomorrow.
      expect(view.current?.id).toBe('new');
      expect(view.terms).toHaveLength(2);
    });
  });
});
