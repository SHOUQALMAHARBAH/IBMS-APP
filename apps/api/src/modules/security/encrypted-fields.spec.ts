import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptEntityFields,
  encryptEntityFields,
  ENCRYPTED_FIELDS,
} from './encrypted-fields';
import { EncryptionService } from './encryption.service';
import { KeyRegistryService } from './key-registry.service';
import type { AuditService } from '../audit/audit.service';

const ctx = { userId: 'user-1', entityType: 'Customer', entityId: 'c-1' };

function buildEncryption(): EncryptionService {
  process.env.PII_ENCRYPTION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
  process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return new EncryptionService(new KeyRegistryService(), audit);
}

describe('ENCRYPTED_FIELDS — the exact Part 10.2 field map', () => {
  it('covers exactly the entities and fields it is meant to, and nothing else', () => {
    // Exact equality on purpose: this map is deliberately hand-kept rather than
    // derived from the Prisma DMMF, so a new `-- ENCRYPT` field has to be added
    // HERE too — and this assertion is what makes that a reviewed change
    // instead of something that silently starts, or fails to start, encrypting.
    //
    // The five A.3 entities, plus OrganizationEmailIntegration added by
    // multi-tenancy Phase 3 step 11 (Part I §6): not personal data, but the
    // same treatment, because it is the credential that sends mail as a real
    // company.
    expect(ENCRYPTED_FIELDS).toEqual({
      Customer: ['nationalIdEnc', 'contactPhoneEnc', 'contactEmailEnc'],
      UltimateBeneficialOwner: ['nationalIdEnc'],
      InsuredPerson: ['nationalIdEnc'],
      Employee: ['nationalIdEnc'],
      ThirdPartyClaimant: ['contactDetailsEnc'],
      OrganizationEmailIntegration: ['oauthRefreshTokenEnc'],
    });
  });
});

describe('encryptEntityFields / decryptEntityFields', () => {
  let encryption: EncryptionService;

  beforeEach(() => {
    encryption = buildEncryption();
  });

  it('encrypts every flagged field on Customer and decrypts back to the originals', async () => {
    const customer = {
      id: 'c-1',
      legalName: 'Ahmad Ltd',
      nationalIdEnc: '9987654321',
      contactPhoneEnc: '+962791234567',
      contactEmailEnc: 'ahmad@example.com',
    };

    const encrypted = await encryptEntityFields(
      encryption,
      'Customer',
      customer,
      ctx,
    );
    expect(encrypted.legalName).toBe('Ahmad Ltd'); // untouched, not flagged
    expect(encrypted.nationalIdEnc).not.toBe(customer.nationalIdEnc);
    expect(encrypted.contactPhoneEnc).not.toBe(customer.contactPhoneEnc);
    expect(encrypted.contactEmailEnc).not.toBe(customer.contactEmailEnc);

    const decrypted = await decryptEntityFields(
      encryption,
      'Customer',
      encrypted,
      ctx,
    );
    expect(decrypted).toEqual(customer);
  });

  it('leaves null/undefined/empty optional fields alone instead of encrypting them', async () => {
    const insuredPerson = {
      id: 'ip-1',
      fullName: 'Sara',
      nationalIdEnc: null as string | null,
    };
    const encrypted = await encryptEntityFields(
      encryption,
      'InsuredPerson',
      insuredPerson,
      ctx,
    );
    expect(encrypted.nationalIdEnc).toBeNull();
  });

  it('applies to UltimateBeneficialOwner.nationalIdEnc', async () => {
    const ubo = { id: 'ubo-1', fullName: 'Owner', nationalIdEnc: '112233' };
    const encrypted = await encryptEntityFields(
      encryption,
      'UltimateBeneficialOwner',
      ubo,
      ctx,
    );
    expect(encrypted.nationalIdEnc).not.toBe('112233');
    const decrypted = await decryptEntityFields(
      encryption,
      'UltimateBeneficialOwner',
      encrypted,
      ctx,
    );
    expect(decrypted.nationalIdEnc).toBe('112233');
  });

  it('applies to Employee.nationalIdEnc', async () => {
    const employee = { id: 'e-1', fullName: 'Employee', nationalIdEnc: '5544' };
    const encrypted = await encryptEntityFields(
      encryption,
      'Employee',
      employee,
      ctx,
    );
    expect(encrypted.nationalIdEnc).not.toBe('5544');
  });

  it('applies to ThirdPartyClaimant.contactDetailsEnc', async () => {
    const claimant = {
      id: 't-1',
      fullName: 'Third Party',
      contactDetailsEnc: 'phone: 0791112222',
    };
    const encrypted = await encryptEntityFields(
      encryption,
      'ThirdPartyClaimant',
      claimant,
      ctx,
    );
    expect(encrypted.contactDetailsEnc).not.toBe(claimant.contactDetailsEnc);
    const decrypted = await decryptEntityFields(
      encryption,
      'ThirdPartyClaimant',
      encrypted,
      ctx,
    );
    expect(decrypted.contactDetailsEnc).toBe(claimant.contactDetailsEnc);
  });
});
