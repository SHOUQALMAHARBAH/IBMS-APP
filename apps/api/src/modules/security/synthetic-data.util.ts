import { randomInt } from 'node:crypto';
import { ENCRYPTED_FIELDS, type EncryptedEntityName } from './encrypted-fields';

/**
 * Part 10.4/10.5 (backlog A.10) — "masked/synthesized production data in
 * non-production environments." Replaces a real sensitive value with a
 * synthetic one of the same shape: each digit becomes a random digit, each
 * letter a random letter of the same case, everything else (punctuation,
 * spacing) is preserved verbatim. Length is preserved so a downstream
 * format check (e.g. a national-ID length rule) still exercises
 * realistically against Dev/Test/UAT data that is never real production
 * PII.
 */
export function synthesizeSensitiveValue(realValue: string): string {
  return Array.from(realValue)
    .map((char) => {
      if (/[0-9]/.test(char)) return String(randomInt(0, 10));
      if (/[a-z]/.test(char)) return String.fromCharCode(97 + randomInt(0, 26));
      if (/[A-Z]/.test(char)) return String.fromCharCode(65 + randomInt(0, 26));
      return char;
    })
    .join('');
}

/**
 * Replaces every `-- ENCRYPT` field (`ENCRYPTED_FIELDS`, encrypted-fields.ts)
 * present on `data` for `entityName` with a synthetic value, returning a
 * shallow copy — for seeding a non-production database from a production
 * export without carrying real PII into it. Deliberately scoped to the same
 * field list `encryptEntityFields` uses, not a general-purpose anonymizer:
 * a field added there is synthesized here too, by construction.
 */
export function synthesizeEntityFields<T extends Record<string, unknown>>(
  entityName: EncryptedEntityName,
  data: T,
): T {
  const result: Record<string, unknown> = { ...data };
  for (const field of ENCRYPTED_FIELDS[entityName]) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      result[field] = synthesizeSensitiveValue(value);
    }
  }
  return result as T;
}
