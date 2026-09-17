import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  failedPasswordRules,
  passwordByteLength,
  validatePasswordPolicy,
} from './password-policy';

/*
 * `validatePasswordPolicy` is consumed by three things that cannot import each
 * other — the API's auth path, the database seed, and (via the
 * `./password-policy` subpath export) the web's live requirements checklist.
 * Its EXACT strings reach a user through a 422 body, so they are pinned here:
 * the rule list was refactored into `PASSWORD_RULES` to give the web
 * translatable ids, and that refactor had to leave this output untouched.
 */

const VALID = 'Str0ng-Passphrase!';

describe('validatePasswordPolicy', () => {
  it('accepts a password that meets every rule', () => {
    expect(validatePasswordPolicy(VALID)).toEqual([]);
  });

  it('reports each violation with its exact wording', () => {
    expect(validatePasswordPolicy('short')).toEqual([
      'Password must be at least 12 characters',
      'Password must include an uppercase letter',
      'Password must include a digit',
      'Password must include a symbol',
    ]);
  });

  it('keeps violations in rule order, so the joined 422 message is stable', () => {
    const violations = validatePasswordPolicy('aaaaaaaaaaaa');
    expect(violations).toEqual([
      'Password must include an uppercase letter',
      'Password must include a digit',
      'Password must include a symbol',
    ]);
  });

  it('counts the bcrypt ceiling in BYTES, not characters', () => {
    // Arabic letters are two bytes each in UTF-8, so this is well under the
    // character count a naive cap would allow and still over the real limit.
    const arabic = 'أ'.repeat(40) + 'A1!a';
    expect(arabic.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(passwordByteLength(arabic)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(validatePasswordPolicy(arabic).join(' ')).toContain('at most 72 bytes');
  });

  it('reports the actual byte count in the message', () => {
    const over = 'A1!' + 'a'.repeat(PASSWORD_MAX_BYTES);
    expect(validatePasswordPolicy(over)[0]).toContain(`it is ${passwordByteLength(over)}`);
  });
});

describe('PASSWORD_RULES — the ids the web renders from', () => {
  it('exposes every rule exactly once, in the documented order', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual([
      'minLength',
      'maxBytes',
      'lowercase',
      'uppercase',
      'digit',
      'symbol',
    ]);
  });

  it('agrees with validatePasswordPolicy on what fails', () => {
    // The two must never disagree: one drives the API's 422, the other drives
    // the checklist the user is looking at while typing.
    for (const candidate of ['', 'short', 'alllowercase1!', 'ALLUPPERCASE1!', VALID]) {
      expect(failedPasswordRules(candidate)).toHaveLength(
        validatePasswordPolicy(candidate).length,
      );
    }
  });

  it('names minLength as the rule a too-short password breaks', () => {
    expect(failedPasswordRules('Ab1!')).toContain('minLength');
    expect(failedPasswordRules('A'.repeat(PASSWORD_MIN_LENGTH) + 'b1!')).not.toContain('minLength');
  });

  it('satisfiedBy is the inverse of appearing in failedPasswordRules', () => {
    for (const rule of PASSWORD_RULES) {
      expect(rule.satisfiedBy(VALID)).toBe(true);
      expect(failedPasswordRules(VALID)).not.toContain(rule.id);
    }
  });
});
