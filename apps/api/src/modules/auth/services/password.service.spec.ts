import { describe, expect, it } from 'vitest';
import { PasswordService, validatePasswordPolicy } from './password.service';

describe('validatePasswordPolicy', () => {
  it('accepts a password meeting every rule', () => {
    expect(validatePasswordPolicy('Correct-Horse-9')).toEqual([]);
  });

  it('flags a too-short password', () => {
    expect(validatePasswordPolicy('Ab1!')).toContain(
      'Password must be at least 12 characters',
    );
  });

  it('flags missing character classes independently', () => {
    expect(validatePasswordPolicy('alllowercase1!aaaa')).toContain(
      'Password must include an uppercase letter',
    );
    expect(validatePasswordPolicy('ALLUPPERCASE1!AAAA')).toContain(
      'Password must include a lowercase letter',
    );
    expect(validatePasswordPolicy('NoDigitsHere!!!!!!')).toContain(
      'Password must include a digit',
    );
    expect(validatePasswordPolicy('NoSymbolsHere12345')).toContain(
      'Password must include a symbol',
    );
  });

  it('reports every violated rule at once, not just the first', () => {
    const violations = validatePasswordPolicy('short');
    expect(violations.length).toBeGreaterThan(1);
  });
});

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password and verifies it round-trips', async () => {
    const hash = await service.hash('Correct-Horse-9');
    expect(hash).not.toBe('Correct-Horse-9');
    expect(await service.verify('Correct-Horse-9', hash)).toBe(true);
  });

  it('rejects the wrong password against a real hash', async () => {
    const hash = await service.hash('Correct-Horse-9');
    expect(await service.verify('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash for the same password each call (salted)', async () => {
    const a = await service.hash('Correct-Horse-9');
    const b = await service.hash('Correct-Horse-9');
    expect(a).not.toBe(b);
  });
});
