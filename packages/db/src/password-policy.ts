/**
 * Part 10.1 password policy — length + character-class complexity.
 *
 * Lives in `@ibms/db` rather than in `apps/api` because it has TWO consumers
 * that cannot import from each other: the runtime auth path
 * (`apps/api/src/modules/auth/services/password.service.ts`, which re-exports
 * this so its own callers and tests are unaffected) and the database seed
 * (`packages/db/prisma/seed.ts`, which validates `BOOTSTRAP_ADMIN_PASSWORD`
 * before hashing it). Duplicating it would let a seeded credential drift
 * below the policy the login path enforces.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * bcrypt hashes at most 72 BYTES and silently discards the rest, so anything
 * past that is decorative: two passwords sharing a 72-byte prefix are the same
 * password as far as authentication is concerned. Rejecting is honest;
 * accepting a 200-character password and quietly using 72 bytes of it is not.
 *
 * BYTES, not characters, and that distinction is load-bearing in a bilingual
 * app: Arabic code points are 2-3 bytes in UTF-8, so a 40-character Arabic
 * passphrase already exceeds the limit while a 40-character ASCII one does
 * not. A character-count cap would silently truncate exactly the users this
 * system is built for.
 */
export const PASSWORD_MAX_BYTES = 72;

export function passwordByteLength(password: string): number {
  // Buffer is not available in every consumer (browser bundles), TextEncoder
  // is. Both are UTF-8.
  return new TextEncoder().encode(password).length;
}

export function validatePasswordPolicy(password: string): string[] {
  const violations: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  const bytes = passwordByteLength(password);
  if (bytes > PASSWORD_MAX_BYTES) {
    violations.push(
      `Password must be at most ${PASSWORD_MAX_BYTES} bytes (it is ${bytes}); bcrypt ignores anything beyond that, so the extra characters would not protect the account`,
    );
  }
  if (!/[a-z]/.test(password))
    violations.push("Password must include a lowercase letter");
  if (!/[A-Z]/.test(password))
    violations.push("Password must include an uppercase letter");
  if (!/[0-9]/.test(password)) violations.push("Password must include a digit");
  if (!/[^A-Za-z0-9]/.test(password))
    violations.push("Password must include a symbol");
  return violations;
}
