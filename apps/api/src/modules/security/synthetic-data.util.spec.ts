import { describe, expect, it } from 'vitest';
import {
  synthesizeEntityFields,
  synthesizeSensitiveValue,
} from './synthetic-data.util';

describe('synthesizeSensitiveValue', () => {
  it('preserves length', () => {
    expect(synthesizeSensitiveValue('9871234567')).toHaveLength(10);
  });

  it('replaces every digit with a digit', () => {
    const result = synthesizeSensitiveValue('9871234567');
    expect(result).toMatch(/^\d{10}$/);
  });

  it('replaces letters with letters of the same case', () => {
    const result = synthesizeSensitiveValue('AbC123xyz');
    expect(result[0]).toMatch(/[A-Z]/);
    expect(result[1]).toMatch(/[a-z]/);
    expect(result[2]).toMatch(/[A-Z]/);
    expect(result.slice(3, 6)).toMatch(/^\d{3}$/);
    expect(result.slice(6)).toMatch(/^[a-z]{3}$/);
  });

  it('preserves punctuation/spacing verbatim', () => {
    expect(synthesizeSensitiveValue('12-345 678')).toMatch(
      /^\d{2}-\d{3} \d{3}$/,
    );
  });

  it('never reproduces the original value (astronomically unlikely for a 10-digit id)', () => {
    const original = '9871234567';
    expect(synthesizeSensitiveValue(original)).not.toBe(original);
  });

  it('handles an empty string', () => {
    expect(synthesizeSensitiveValue('')).toBe('');
  });
});

describe('synthesizeEntityFields', () => {
  it('synthesizes only the ENCRYPTED_FIELDS for the given entity', () => {
    const original = {
      nationalIdEnc: '9871234567',
      contactPhoneEnc: '0791234567',
      contactEmailEnc: 'real@example.com',
      productLine: 'Motor', // not in ENCRYPTED_FIELDS.Customer — untouched
    };
    const result = synthesizeEntityFields('Customer', original);

    expect(result.nationalIdEnc).not.toBe(original.nationalIdEnc);
    expect(result.nationalIdEnc).toHaveLength(original.nationalIdEnc.length);
    expect(result.contactPhoneEnc).not.toBe(original.contactPhoneEnc);
    expect(result.contactEmailEnc).not.toBe(original.contactEmailEnc);
    expect(result.productLine).toBe('Motor');
  });

  it('leaves a null/undefined/empty encrypted field untouched', () => {
    const original = {
      nationalIdEnc: '',
      contactPhoneEnc: undefined,
      contactEmailEnc: null,
    };
    const result = synthesizeEntityFields(
      'Customer',
      original as unknown as Record<string, unknown>,
    );
    expect(result.nationalIdEnc).toBe('');
    expect(result.contactPhoneEnc).toBeUndefined();
    expect(result.contactEmailEnc).toBeNull();
  });

  it('does not mutate the input object', () => {
    const original = { nationalIdEnc: '9871234567' };
    const frozen = Object.freeze({ ...original });
    expect(() => synthesizeEntityFields('Customer', frozen)).not.toThrow();
  });

  it('handles a single-field entity (UltimateBeneficialOwner)', () => {
    const original = { nationalIdEnc: '1234567890', ownerName: 'Real Name' };
    const result = synthesizeEntityFields('UltimateBeneficialOwner', original);
    expect(result.nationalIdEnc).not.toBe(original.nationalIdEnc);
    expect(result.ownerName).toBe('Real Name');
  });
});
