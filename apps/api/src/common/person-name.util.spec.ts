import { describe, expect, it } from 'vitest';
import { composeFullName } from './person-name.util';

describe('composeFullName', () => {
  it('joins all 4 parts in order with a single space', () => {
    expect(
      composeFullName({
        givenName: 'أحمد',
        fatherName: 'محمد',
        grandfatherName: 'علي',
        familyName: 'الشريف',
      }),
    ).toBe('أحمد محمد علي الشريف');
  });

  it('skips a missing optional part instead of leaving a double space', () => {
    expect(
      composeFullName({
        givenName: 'أحمد',
        familyName: 'الشريف',
      }),
    ).toBe('أحمد الشريف');
  });

  it('skips grandfatherName only, keeping fatherName', () => {
    expect(
      composeFullName({
        givenName: 'أحمد',
        fatherName: 'محمد',
        familyName: 'الشريف',
      }),
    ).toBe('أحمد محمد الشريف');
  });

  it('trims each part before joining', () => {
    expect(
      composeFullName({
        givenName: '  أحمد  ',
        familyName: '  الشريف  ',
      }),
    ).toBe('أحمد الشريف');
  });

  it('treats an empty-string optional part as missing, not a literal empty segment', () => {
    expect(
      composeFullName({
        givenName: 'أحمد',
        fatherName: '',
        grandfatherName: '   ',
        familyName: 'الشريف',
      }),
    ).toBe('أحمد الشريف');
  });
});
