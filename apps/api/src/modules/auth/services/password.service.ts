import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { validatePasswordPolicy } from '@ibms/db';

const BCRYPT_ROUNDS = 12;

/**
 * Part 10.1 password policy. The rule itself lives in `@ibms/db`
 * (`packages/db/src/password-policy.ts`) because the database seed has to
 * apply the identical check to `BOOTSTRAP_ADMIN_PASSWORD` and cannot import
 * from `apps/api`. Re-exported here so every existing caller and test that
 * imports `validatePasswordPolicy` from this module keeps working.
 */
export { validatePasswordPolicy };

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  }

  verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  validatePolicy(password: string): string[] {
    return validatePasswordPolicy(password);
  }

  /**
   * Throws unless the password satisfies the Part 10.1 policy.
   *
   * The throwing form exists so callers cannot accept a password by forgetting
   * to look at the returned array — `validatePolicy` returns violations, and an
   * ignored non-empty array is silently a policy bypass.
   */
  assertMeetsPolicy(password: string): void {
    const violations = validatePasswordPolicy(password);
    if (violations.length > 0) {
      throw new UnprocessableEntityException(violations.join(' '));
    }
  }
}
