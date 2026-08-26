import type { EncryptionService, KeyUseContext } from './encryption.service';

/**
 * The exact `-- ENCRYPT` field map from packages/db/prisma/schema.prisma
 * (Part 10.2). Kept as one explicit constant, not derived from the Prisma
 * DMMF, so a new `-- ENCRYPT` field added to the schema is a deliberate,
 * reviewable addition here too — not something that starts encrypting (or
 * fails to) silently.
 */
export const ENCRYPTED_FIELDS = {
  Customer: ['nationalIdEnc', 'contactPhoneEnc', 'contactEmailEnc'],
  UltimateBeneficialOwner: ['nationalIdEnc'],
  InsuredPerson: ['nationalIdEnc'],
  Employee: ['nationalIdEnc'],
  ThirdPartyClaimant: ['contactDetailsEnc'],
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
