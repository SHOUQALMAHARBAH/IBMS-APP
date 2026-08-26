import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

// Field-level encryption for `-- ENCRYPT` columns (Part 10.2), e.g.
// MfaCredential.secretEnc. AES-256-GCM: random 12-byte IV per call, auth tag
// appended so tampering is detected on decrypt, not silently accepted.
const ALGORITHM = 'aes-256-gcm';

function encryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'MFA_ENCRYPTION_KEY is not set — required to encrypt/decrypt MFA secrets',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'MFA_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes',
    );
  }
  return key;
}

/** Encrypts `plaintext`, returning `iv:authTag:ciphertext`, all base64. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

/** Reverses {@link encryptField}. Throws if the value was tampered with. */
export function decryptField(encoded: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted field value');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * One-way hash for bearer secrets we must be able to look up but never need
 * to reveal again (refresh tokens, password-reset tokens). Not for
 * passwords — those use bcryptjs's salted hash via PasswordService.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** A high-entropy opaque bearer token — not a JWT, just a random secret. */
export function generateOpaqueToken(): string {
  return randomBytes(48).toString('hex');
}
