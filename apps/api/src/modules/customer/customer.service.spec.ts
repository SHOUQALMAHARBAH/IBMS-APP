import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { ProspectRepository } from '../../repositories/prospect.repository';
import type { AuditService } from '../audit/audit.service';
import type { EncryptionService } from '../security/encryption.service';
import type { SensitiveFieldRevealService } from '../security/sensitive-field-reveal.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateCustomerDto } from './dto/create-customer.dto';

function makeUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

function makeDeps() {
  const create = vi.fn().mockImplementation((input: { id: string }) =>
    Promise.resolve({
      status: 'PENDING_KYC',
      classification: 'CONFIDENTIAL',
      ...input,
    }),
  );
  const findById = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const createUbo = vi
    .fn()
    .mockImplementation((input) => Promise.resolve({ ...input }));
  const findUbosByCustomerId = vi.fn().mockResolvedValue([]);
  const createDocument = vi
    .fn()
    .mockImplementation((input) => Promise.resolve({ id: 'doc-1', ...input }));
  const findDocumentsByCustomerId = vi.fn().mockResolvedValue([]);
  const customers = {
    create,
    findById,
    findMany,
    createUbo,
    findUbosByCustomerId,
    createDocument,
    findDocumentsByCustomerId,
  } as unknown as CustomerRepository;

  const findProspectById = vi.fn();
  const prospects = {
    findById: findProspectById,
  } as unknown as ProspectRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  // Deterministic reversible "encryption" for assertions — real
  // EncryptionService/KeyRegistryService are exercised by their own specs.
  const encrypt = vi
    .fn()
    .mockImplementation((_purpose: string, plaintext: string) =>
      Promise.resolve(`enc:${plaintext}`),
    );
  const decrypt = vi
    .fn()
    .mockImplementation((_purpose: string, encoded: string) =>
      Promise.resolve(encoded.replace(/^enc:/, '')),
    );
  const encryption = { encrypt, decrypt } as unknown as EncryptionService;

  const mask = vi.fn().mockImplementation((value: string) => `masked:${value}`);
  const revealFn = vi.fn().mockResolvedValue('plaintext-value');
  const reveal = {
    mask,
    reveal: revealFn,
  } as unknown as SensitiveFieldRevealService;

  return {
    service: new CustomerService(
      customers,
      prospects,
      audit,
      encryption,
      reveal,
    ),
    mocks: {
      create,
      findById,
      findMany,
      createUbo,
      findUbosByCustomerId,
      createDocument,
      findDocumentsByCustomerId,
      findProspectById,
      record,
      encrypt,
      decrypt,
      mask,
      revealFn,
    },
  };
}

const INDIVIDUAL_DTO: CreateCustomerDto = {
  customerType: 'INDIVIDUAL',
  legalName: 'Ahmad Test',
  nationalId: '9901012345',
  contactPhone: '+962-7-9000-0000',
  contactEmail: 'ahmad@example.test',
  languagePreference: 'AR',
};

describe('CustomerService', () => {
  describe('create', () => {
    it('encrypts the three -- ENCRYPT fields before persisting, never the raw plaintext', async () => {
      const { service, mocks } = makeDeps();

      const customer = await service.create(INDIVIDUAL_DTO, 'sales-1');

      expect(mocks.encrypt).toHaveBeenCalledTimes(3);
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nationalIdEnc: 'enc:9901012345',
          contactPhoneEnc: 'enc:+962-7-9000-0000',
          contactEmailEnc: 'enc:ahmad@example.test',
          ownerUserId: 'sales-1',
        }),
      );
      expect(customer.ownerUserId).toBe('sales-1');
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Customer' }),
      );

      // The response itself must be masked, the same as get() — never the
      // bare row with its raw ciphertext fields.
      expect(customer).not.toHaveProperty('nationalIdEnc');
      expect(customer).not.toHaveProperty('contactPhoneEnc');
      expect(customer).not.toHaveProperty('contactEmailEnc');
      expect(customer.nationalId).toBe('masked:9901012345');
    });

    it("throws NotFoundException for another officer's prospectId, without creating a Customer", async () => {
      const { service, mocks } = makeDeps();
      mocks.findProspectById.mockResolvedValue({
        id: 'prospect-1',
        salesOwnerUserId: 'sales-2',
      });

      await expect(
        service.create(
          { ...INDIVIDUAL_DTO, prospectId: 'prospect-1' },
          'sales-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('creates from an owned prospectId', async () => {
      const { service, mocks } = makeDeps();
      mocks.findProspectById.mockResolvedValue({
        id: 'prospect-1',
        salesOwnerUserId: 'sales-1',
      });

      await service.create(
        { ...INDIVIDUAL_DTO, prospectId: 'prospect-1' },
        'sales-1',
      );

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ prospectId: 'prospect-1' }),
      );
    });
  });

  describe('list', () => {
    it('forces a Sales Officer to their own book of customers', async () => {
      const { service, mocks } = makeDeps();

      await service.list(
        { ownerUserId: 'sales-2' },
        makeUser({ id: 'sales-1' }),
      );

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: 'sales-1' }),
      );
    });

    it('lets a Compliance Officer see every owner', async () => {
      const { service, mocks } = makeDeps();

      await service.list(
        { ownerUserId: 'sales-2' },
        makeUser({ id: 'compliance-1', roles: ['COMPLIANCE_OFFICER'] }),
      );

      expect(mocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: 'sales-2' }),
      );
    });

    it('never returns the raw encrypted fields, and never decrypts them either', async () => {
      const { service, mocks } = makeDeps();
      mocks.findMany.mockResolvedValue([
        {
          id: 'cust-1',
          ownerUserId: 'sales-1',
          nationalIdEnc: 'enc:9901012345',
          contactPhoneEnc: 'enc:+962-7-9000-0000',
          contactEmailEnc: 'enc:ahmad@example.test',
        },
      ]);

      const [customer] = await service.list({}, makeUser({ id: 'sales-1' }));

      expect(customer).not.toHaveProperty('nationalIdEnc');
      expect(customer).not.toHaveProperty('contactPhoneEnc');
      expect(customer).not.toHaveProperty('contactEmailEnc');
      expect(mocks.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it("hides another officer's customer behind NotFoundException", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });

      await expect(
        service.get('cust-1', makeUser({ id: 'sales-1' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns masked (not raw) sensitive fields, decrypted only for display', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-1',
        nationalIdEnc: 'enc:9901012345',
        contactPhoneEnc: 'enc:+962-7-9000-0000',
        contactEmailEnc: 'enc:ahmad@example.test',
      });

      const profile = await service.get('cust-1', makeUser({ id: 'sales-1' }));

      expect(profile).not.toHaveProperty('nationalIdEnc');
      expect(profile.nationalId).toBe('masked:9901012345');
      expect(mocks.decrypt).toHaveBeenCalledTimes(3);
    });

    it('lets an External Auditor read any customer, read-only', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });

      const profile = await service.get(
        'cust-1',
        makeUser({ id: 'auditor-1', roles: ['EXTERNAL_AUDITOR'] }),
      );
      expect(profile.id).toBe('cust-1');
    });
  });

  describe('revealField', () => {
    it('requires a written reason via SensitiveFieldRevealService.reveal (delegated, not re-implemented)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-1',
        nationalIdEnc: 'enc:9901012345',
      });

      const result = await service.revealField(
        'cust-1',
        {
          field: 'nationalId',
          reason: 'verifying against a photo ID on a call',
        },
        makeUser({ id: 'sales-1' }),
      );

      expect(mocks.revealFn).toHaveBeenCalledWith(
        expect.objectContaining({
          field: 'nationalId',
          encryptedValue: 'enc:9901012345',
          reason: 'verifying against a photo ID on a call',
        }),
      );
      expect(result.value).toBe('plaintext-value');
    });

    it('throws NotFoundException for a field with no value set', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-1',
        nationalIdEnc: null,
      });

      await expect(
        service.revealField(
          'cust-1',
          { field: 'nationalId', reason: 'verifying against a photo ID' },
          makeUser({ id: 'sales-1' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addUbo', () => {
    it("hides another officer's customer behind NotFoundException, same as get()", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        customerType: 'CORPORATE',
        ownerUserId: 'sales-2',
      });

      await expect(
        service.addUbo(
          'cust-1',
          { fullName: 'Someone', nationalId: '123', isPep: false },
          makeUser({ id: 'sales-1' }),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.createUbo).not.toHaveBeenCalled();
    });

    it('lets a Compliance Officer add a UBO to a customer they do not own', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        customerType: 'CORPORATE',
        ownerUserId: 'sales-2',
      });

      await service.addUbo(
        'cust-1',
        { fullName: 'Someone', nationalId: '9901012345', isPep: false },
        makeUser({ id: 'compliance-1', roles: ['COMPLIANCE_OFFICER'] }),
      );

      expect(mocks.createUbo).toHaveBeenCalled();
    });

    it('rejects a UBO on an INDIVIDUAL customer', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        customerType: 'INDIVIDUAL',
        ownerUserId: 'sales-1',
      });

      await expect(
        service.addUbo(
          'cust-1',
          { fullName: 'Someone', nationalId: '123', isPep: false },
          makeUser({ id: 'sales-1' }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.createUbo).not.toHaveBeenCalled();
    });

    it('encrypts the UBO nationalId before persisting, and never returns the raw ciphertext', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        customerType: 'CORPORATE',
        ownerUserId: 'sales-1',
      });

      const ubo = await service.addUbo(
        'cust-1',
        { fullName: 'Someone', nationalId: '9901012345', isPep: true },
        makeUser({ id: 'sales-1' }),
      );

      expect(mocks.createUbo).toHaveBeenCalledWith(
        expect.objectContaining({
          nationalIdEnc: 'enc:9901012345',
          isPep: true,
        }),
      );
      expect(ubo).not.toHaveProperty('nationalIdEnc');
      expect(ubo.nationalId).toBe('masked:9901012345');
    });
  });

  describe('addDocument', () => {
    it("hides another officer's customer behind NotFoundException", async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });

      await expect(
        service.addDocument(
          'cust-1',
          {
            classification: 'CONFIDENTIAL',
            fileName: 'proposal.pdf',
            storageRef: 'ref-1',
          },
          makeUser({ id: 'sales-1' }),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mocks.createDocument).not.toHaveBeenCalled();
    });

    it('always fixes category to APPLICATION_PROPOSAL, regardless of caller input', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-1',
      });

      const document = await service.addDocument(
        'cust-1',
        {
          classification: 'HIGHLY_CONFIDENTIAL',
          fileName: 'national-id-scan.pdf',
          storageRef: 'ref-123',
        },
        makeUser({ id: 'sales-1' }),
      );

      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'APPLICATION_PROPOSAL' }),
      );
      expect(document.category).toBe('APPLICATION_PROPOSAL');
    });
  });
});
