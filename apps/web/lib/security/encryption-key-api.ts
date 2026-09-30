import { apiGet } from '../auth/api-client';

/*
 * THE PII FIELD-ENCRYPTION KEY INVENTORY — `GET /security/encryption-keys`.
 *
 * Had no web caller (IMPROVEMENTS § 1.44), so the two roles holding
 * `encryption-key.read` — OFFICE_ADMINISTRATOR and SYSTEM_SECURITY_ADMINISTRATOR —
 * could not answer "which key is encrypting our customers' national IDs right now,
 * and how many retired keys are we still holding in order to decrypt older rows?"
 * without inspecting the running process. That is precisely the question a
 * key-management control exists to answer, and the answer was unreachable.
 *
 * NEVER KEY MATERIAL. The endpoint returns an id and a status and nothing else — the
 * keys themselves live in memory/env config and are absent from every response by
 * construction, which is what makes an authorized custodian's browser a safe place to
 * render this at all.
 */
export interface EncryptionKeyMetadata {
  keyId: string;
  /** Exactly one key is active — the one new ciphertext is written with. A retired key
   * is kept because rows encrypted under it must still decrypt, so the COUNT of
   * retired keys is itself the useful figure: it is how much old ciphertext has not
   * been rotated forward. */
  active: boolean;
}

export function listEncryptionKeys(): Promise<EncryptionKeyMetadata[]> {
  return apiGet('/security/encryption-keys');
}
