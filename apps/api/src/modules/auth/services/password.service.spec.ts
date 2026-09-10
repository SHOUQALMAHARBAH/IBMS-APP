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

describe('Part 10.1 password policy — the bcrypt 72-byte ceiling', () => {
  const service = new PasswordService();

  it('rejects a password longer than bcrypt will actually hash', () => {
    // bcrypt hashes at most 72 bytes and silently discards the rest, so two
    // passwords sharing a 72-byte prefix authenticate identically. Accepting a
    // 200-character password and quietly using 72 bytes of it is dishonest
    // about the protection the account actually has.
    const violations = service.validatePolicy(`Aa1!${'x'.repeat(80)}`);
    expect(violations.join(' ')).toMatch(/72 bytes/);
  });

  it('measures BYTES, not characters — an Arabic passphrase hits it sooner', () => {
    // Load-bearing in a bilingual app: Arabic code points are 2 bytes in
    // UTF-8, so a 40-character Arabic passphrase is 80+ bytes while a
    // 40-character ASCII one is 40. A character cap would silently truncate
    // exactly the users this system is built for.
    const arabic = `Aa1!${'م'.repeat(40)}`;
    expect(arabic.length).toBeLessThan(72);
    expect(service.validatePolicy(arabic).join(' ')).toMatch(/72 bytes/);
  });

  it('accepts a strong password inside the ceiling', () => {
    expect(service.validatePolicy('Str0ng!Passphrase-2026')).toEqual([]);
  });
});
