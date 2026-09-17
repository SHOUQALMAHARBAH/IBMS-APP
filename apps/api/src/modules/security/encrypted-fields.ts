import type { EncryptionService, KeyUseContext } from './encryption.service';

/**
 * The `-- ENCRYPT` fields encrypted THROUGH THIS MODULE (Part 10.2). Kept as
 * one explicit constant, not derived from the Prisma DMMF, so a new
 * `-- ENCRYPT` field added to the schema is a deliberate, reviewable addition
 * here too — not something that starts encrypting (or fails to) silently.
 *
 * It is NOT the complete list of encrypted columns in the schema, and it
 * cannot be: `ENCRYPTED_ELSEWHERE` below names the fields that are encrypted
 * by a different path. Adding one of those here would be worse than the
 * documentation gap it closes — this constant DRIVES `encryptEntityFields`,
 * so a field listed twice is a field encrypted twice.
 */
export const ENCRYPTED_FIELDS = {
  Customer: ['nationalIdEnc', 'contactPhoneEnc', 'contactEmailEnc'],
  UltimateBeneficialOwner: ['nationalIdEnc'],
  InsuredPerson: ['nationalIdEnc'],
  Employee: ['nationalIdEnc'],
  ThirdPartyClaimant: ['contactDetailsEnc'],
  // Part I §6. Not personal data, but the same `-- ENCRYPT` treatment: this is
  // the credential that sends mail as a real company. Written and read by
  // `EmailProviderRegistry`/`OrganizationEmailIntegrationService` under the
  // `oauth` purpose, not by the generic helpers below.
  OrganizationEmailIntegration: ['oauthRefreshTokenEnc'],
} as const satisfies Record<string, readonly string[]>;

/**
 * `-- ENCRYPT` columns that are genuinely encrypted, but NOT by this module.
 *
 * Declared so the two can be reconciled: Part G's checklist asks that every
 * `-- ENCRYPT` field is actually encrypted, and that question was previously
 * unanswerable because `ENCRYPTED_FIELDS` looked like the whole list and was
 * not. Listing them here (rather than above) keeps the inventory honest
 * without routing them through `encryptEntityFields`, which would encrypt an
 * already-encrypted value.
 *
 * `MfaCredential.secretEnc` — written by `MfaService.encryptSecret()`, which
 * calls `common/crypto.util.ts#encryptField` (AES-256-GCM, random IV per
 * call) under the dedicated `MFA_ENCRYPTION_KEY`. A TOTP secret is an
 * authentication credential rather than customer data, and it deliberately
 * does not share a key with the personal-data columns above.
 */
export const ENCRYPTED_ELSEWHERE = {
  MfaCredential: ['secretEnc'],
} as const satisfies Record<string, readonly string[]>;

export type EncryptedEntityName = keyof typeof ENCRYPTED_FIELDS;

type EncryptFieldsContext = Omit<KeyUseContext, 'field'>;

/**
 * Encrypts every `-- ENCRYPT` field present on `data` for `entityName`,
 * returning a shallow copy. A field that is `null`/`undefined`/`''` is left
 * as-is (nothing to encrypt, and decrypt must not choke on it later) —
 * these entities largely have optional national-ID/contact fields.
 *
 * No repository consumes this yet — Customer/UBO/InsuredPerson/Employee/
 * ThirdPartyClaimant have no CRUD module (Part C business modules aren't
 * built yet, same reasoning as the RBAC permission grid). This exists so
 * whichever module creates those records adopts field-level encryption by
 * construction instead of reinventing (or forgetting) it.
 */
export async function encryptEntityFields<T extends Record<string, unknown>>(
  encryption: EncryptionService,
  entityName: EncryptedEntityName,
  data: T,
  ctx: EncryptFieldsContext,
): Promise<T> {
  const result: Record<string, unknown> = { ...data };
  for (const field of ENCRYPTED_FIELDS[entityName]) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      result[field] = await encryption.encrypt('pii', value, {
        ...ctx,
        field,
      });
    }
  }
  return result as T;
}

/** Reverses {@link encryptEntityFields}. */
export async function decryptEntityFields<T extends Record<string, unknown>>(
  encryption: EncryptionService,
  entityName: EncryptedEntityName,
  data: T,
  ctx: EncryptFieldsContext,
): Promise<T> {
  const result: Record<string, unknown> = { ...data };
  for (const field of ENCRYPTED_FIELDS[entityName]) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      result[field] = await encryption.decrypt('pii', value, {
        ...ctx,
        field,
      });
    }
  }
  return result as T;
}
