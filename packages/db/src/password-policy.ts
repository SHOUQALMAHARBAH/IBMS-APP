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

/**
 * The rule ids, so a consumer that cannot use the English strings below can
 * still say WHICH rule failed.
 *
 * `validatePasswordPolicy` returns prose, which is right for the API (it goes
 * straight into the 422 body) and wrong for the web, which renders in Arabic
 * or English depending on the signed-in user. The web therefore evaluates
 * these same predicates and looks the wording up in its own dictionary —
 * one set of RULES, two sets of words, and no second copy of the logic.
 */
export type PasswordRuleId =
  | "minLength"
  | "maxBytes"
  | "lowercase"
  | "uppercase"
  | "digit"
  | "symbol";

export interface PasswordRule {
  id: PasswordRuleId;
  /** True when the password satisfies this rule. */
  satisfiedBy(password: string): boolean;
  /** The API-facing wording. Consumers that render to a person in their own
   *  language should use `id` and translate it instead. */
  message(password: string): string;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "minLength",
    satisfiedBy: (p) => p.length >= PASSWORD_MIN_LENGTH,
    message: () => `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  },
  {
    id: "maxBytes",
    satisfiedBy: (p) => passwordByteLength(p) <= PASSWORD_MAX_BYTES,
    message: (p) =>
      `Password must be at most ${PASSWORD_MAX_BYTES} bytes (it is ${passwordByteLength(p)}); bcrypt ignores anything beyond that, so the extra characters would not protect the account`,
  },
  {
    id: "lowercase",
    satisfiedBy: (p) => /[a-z]/.test(p),
    message: () => "Password must include a lowercase letter",
  },
  {
    id: "uppercase",
    satisfiedBy: (p) => /[A-Z]/.test(p),
    message: () => "Password must include an uppercase letter",
  },
  {
    id: "digit",
    satisfiedBy: (p) => /[0-9]/.test(p),
    message: () => "Password must include a digit",
  },
  {
    id: "symbol",
    satisfiedBy: (p) => /[^A-Za-z0-9]/.test(p),
    message: () => "Password must include a symbol",
  },
];

/** The ids of every rule this password currently fails, in declaration order. */
export function failedPasswordRules(password: string): PasswordRuleId[] {
  return PASSWORD_RULES.filter((rule) => !rule.satisfiedBy(password)).map(
    (rule) => rule.id,
  );
}

export function validatePasswordPolicy(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.satisfiedBy(password)).map(
    (rule) => rule.message(password),
  );
}
