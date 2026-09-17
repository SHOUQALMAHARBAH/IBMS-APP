import { describe, expect, it } from 'vitest';
import { resolveDisplayName } from './display-name.util';

describe('resolveDisplayName', () => {
  it('prefers the linked HR record — the four-part official name', () => {
    expect(
      resolveDisplayName({
        fullName: 'Demo Sales Relationship Officer',
        employee: { fullName: 'طارق ناصر كريم الزعبي' },
      }),
    ).toBe('طارق ناصر كريم الزعبي');
  });

  it('falls back to the account name when nothing is linked', () => {
    expect(
      resolveDisplayName({ fullName: 'Branch Manager', employee: null }),
    ).toBe('Branch Manager');
    expect(resolveDisplayName({ fullName: 'Branch Manager' })).toBe(
      'Branch Manager',
    );
  });

  it('falls back when the linked record carries an empty or blank name', () => {
    // A blank official name would render an empty navbar and an empty avatar,
    // which is worse than the free-text fallback it replaced.
    expect(
      resolveDisplayName({
        fullName: 'Branch Manager',
        employee: { fullName: '' },
      }),
    ).toBe('Branch Manager');
    expect(
      resolveDisplayName({
        fullName: 'Branch Manager',
        employee: { fullName: '   ' },
      }),
    ).toBe('Branch Manager');
  });

  it('does not trim a legitimate name into something else', () => {
    expect(
      resolveDisplayName({
        fullName: 'x',
        employee: { fullName: ' أحمد الهاشمي ' },
      }),
    ).toBe('أحمد الهاشمي');
  });
});
