import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const MIN_LENGTH = 12;

/**
 * Part 10.1 password policy: length + character-class complexity. Kept as a
 * pure function (not just a DTO regex) so it's unit-testable on its own and
 * reusable from both signup and reset-password.
 */
export function validatePasswordPolicy(password: string): string[] {
  const violations: string[] = [];
  if (password.length < MIN_LENGTH) {
    violations.push(`Password must be at least ${MIN_LENGTH} characters`);
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
}
