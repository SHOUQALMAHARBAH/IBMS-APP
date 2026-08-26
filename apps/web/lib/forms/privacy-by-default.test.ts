import { describe, expect, it } from 'vitest';
import { assertNoPresetSensitiveDefaults } from './privacy-by-default';

describe('assertNoPresetSensitiveDefaults', () => {
  it('allows empty/undefined/null sensitive fields', () => {
    expect(() =>
      assertNoPresetSensitiveDefaults(
        { nationalId: '', bankAccount: undefined, medicalNotes: null },
        ['nationalId', 'bankAccount', 'medicalNotes'],
      ),
    ).not.toThrow();
  });

  it('allows an empty array for a multi-select sensitive field', () => {
    expect(() =>
      assertNoPresetSensitiveDefaults({ diagnoses: [] }, ['diagnoses']),
    ).not.toThrow();
  });

  it('allows non-sensitive fields to be pre-filled', () => {
    expect(() =>
      assertNoPresetSensitiveDefaults(
        { productLine: 'Motor', nationalId: '' },
        ['nationalId'],
      ),
    ).not.toThrow();
  });

  it('rejects a pre-filled sensitive field', () => {
    expect(() =>
      assertNoPresetSensitiveDefaults(
        { nationalId: '9871234567' },
        ['nationalId'],
      ),
    ).toThrow(/nationalId/);
  });

  it('rejects a pre-selected sensitive field with a non-empty array', () => {
    expect(() =>
      assertNoPresetSensitiveDefaults(
        { diagnoses: ['diabetes'] },
        ['diagnoses'],
      ),
    ).toThrow(/diagnoses/);
  });

  it('lists every violating field, not just the first', () => {
    expect(() =>
      assertNoPresetSensitiveDefaults(
        { nationalId: '123', bankAccount: '456' },
        ['nationalId', 'bankAccount'],
      ),
    ).toThrow(/nationalId, bankAccount/);
  });
});
