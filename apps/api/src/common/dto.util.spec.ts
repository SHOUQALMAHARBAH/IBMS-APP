import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NO_FULL_ACCOUNT_NUMBER, hasExactlyOneOwner } from './dto.util';

describe('hasExactlyOneOwner', () => {
  it('is true with only customerId', () => {
    expect(hasExactlyOneOwner({ customerId: 'cust-1' })).toBe(true);
  });

  it('is true with only insuredPersonId', () => {
    expect(hasExactlyOneOwner({ insuredPersonId: 'ip-1' })).toBe(true);
  });

  it('is false with neither', () => {
    expect(hasExactlyOneOwner({})).toBe(false);
  });

  it('is false with both', () => {
    expect(
      hasExactlyOneOwner({ customerId: 'cust-1', insuredPersonId: 'ip-1' }),
    ).toBe(false);
  });
});

/**
 * `sensitive-data-handling.md` — this guard keeps a full card / bank account
 * number out of the 21 free-text fields that sit beside masked-data paths.
 * It had no test at all until a 3%-per-run e2e flake traced back to it.
 *
 * The two halves have to be asserted together: loosening it until UUIDs pass
 * is only correct if real card and account numbers still fail.
 */
describe('NO_FULL_ACCOUNT_NUMBER', () => {
  const accepts = (v: string) => NO_FULL_ACCOUNT_NUMBER.test(v);

  describe('rejects real card and account numbers', () => {
    it.each([
      ['Visa, 16 digits', '4111111111111111'],
      ['Amex, 15 digits', '378282246310005'],
      ['Maestro, 12 digits — the ISO/IEC 7812 floor', '123456789012'],
      ['UnionPay, 19 digits — the ceiling', '6212345678901234567'],
      ['13 digits', '4111111111111'],
      ['a Jordanian IBAN', 'JO94CBJO0010000000000131000302'],
      ['a card buried in prose', 'client gave 4111111111111111 by phone'],
      ['a card buried in Arabic prose', 'رقم البطاقة 4111111111111111 مسجل'],
    ])('%s', (_label, value) => {
      expect(accepts(value)).toBe(false);
    });

    it('scans past the first line', () => {
      // The regression this locks in: the old rule's body used [\s\S]* but
      // its lookahead used .*, so it only ever scanned line one and a card
      // number on line two was accepted — a false negative in a control whose
      // whole purpose is catching exactly that.
      expect(accepts('note\n4111111111111111')).toBe(false);
      expect(accepts('line one\nline two\nline three 4111111111111111')).toBe(
        false,
      );
    });

    it('does not let a UUID launder a card number beside it', () => {
      expect(
        accepts(
          'ref fb3ee725-164a-4a55-b7d7-091378515012 card 4111111111111111',
        ),
      ).toBe(false);
    });

    it('does not exempt digits merely appended to a UUID tail', () => {
      // 16 contiguous digits here, which is not a UUID shape at all.
      expect(accepts('fb3ee725-164a-4a55-b7d7-0913785150121234')).toBe(false);
    });
  });

  describe('accepts what is not an account number', () => {
    it.each([
      ['a canonical UUID', 'fb3ee725-164a-4a55-b7d7-091378515012'],
      [
        'a UUID whose final group is all digits',
        '11111111-1111-4111-8111-091378515012',
      ],
      ['an uppercase UUID', 'FB3EE725-164A-4A55-B7D7-091378515012'],
      [
        'a UUID in a sentence',
        'See hold fb3ee725-164a-4a55-b7d7-091378515012.',
      ],
      [
        'a UUID in Arabic prose',
        'حجز قانوني fb3ee725-164a-4a55-b7d7-091378515012',
      ],
      [
        'two UUIDs',
        'a 00000000-0000-4000-8000-000000000000 b 11111111-1111-4111-8111-111111111111',
      ],
      ['a Jordanian mobile number', '0791234567'],
      ['a date', '20260913'],
      ['11 digits — one below the PAN floor', '12345678901'],
      ['ordinary prose', 'Active Legal Hold on this file.'],
    ])('%s', (_label, value) => {
      expect(accepts(value)).toBe(true);
    });

    it('accepts every UUID the runtime actually generates', () => {
      // The flake this rule caused was probabilistic: 3.11% of v4 UUIDs hold a
      // run of 9+ digits, so a test passing a real id failed about one run in
      // 32. A single hand-picked example would not have caught it, and would
      // not catch a regression either.
      const rejected = Array.from({ length: 20_000 }, () =>
        randomUUID(),
      ).filter((id) => !accepts(id));
      expect(rejected).toEqual([]);
    });
  });
});
