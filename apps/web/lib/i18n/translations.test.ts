import { describe, expect, it } from 'vitest';
import { LANGUAGES, translate } from './translations';

describe('translate', () => {
  it('returns the AR string for AR', () => {
    expect(translate('AR', 'language')).toBe('اللغة');
  });

  it('returns the EN string for EN', () => {
    expect(translate('EN', 'language')).toBe('Language');
  });

  it('has every key defined for every language', () => {
    const arKeys = Object.keys({
      language: translate('AR', 'language'),
      switchToArabic: translate('AR', 'switchToArabic'),
      switchToEnglish: translate('AR', 'switchToEnglish'),
      signedInAs: translate('AR', 'signedInAs'),
      noRoleAssigned: translate('AR', 'noRoleAssigned'),
      signOut: translate('AR', 'signOut'),
    });
    for (const key of arKeys) {
      for (const language of LANGUAGES) {
        expect(translate(language, key as Parameters<typeof translate>[1])).toBeTypeOf('string');
      }
    }
  });
});
