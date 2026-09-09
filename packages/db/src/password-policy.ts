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

export function validatePasswordPolicy(password: string): string[] {
  const violations: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  if (!/[a-z]/.test(password))
    violations.push('Password must include a lowercase letter');
  if (!/[A-Z]/.test(password))
    violations.push('Password must include an uppercase letter');
  if (!/[0-9]/.test(password)) violations.push('Password must include a digit');
  if (!/[^A-Za-z0-9]/.test(password))
    violations.push('Password must include a symbol');
  return violations;
}
