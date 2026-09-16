import { describe, expect, it } from 'vitest';
import { initialsFrom } from './initials';

describe('initialsFrom', () => {
  it('takes the first and last tokens of a Latin name', () => {
    expect(initialsFrom('Branch Manager')).toBe('BM');
    // "Al" is its own token in the Latin transliteration, so the last token
    // is "Hashimi" — unlike the Arabic spelling below, where the article is
    // attached to the family name and the initial is ا.
    expect(initialsFrom('Ahmad Khalid Yousef Al Hashimi')).toBe('AH');
  });

  it('works on an Arabic name — the case a [A-Z] regex returns nothing for', () => {
    expect(initialsFrom('أحمد الهاشمي')).toBe('أا');
    expect(initialsFrom('أحمد خالد يوسف الهاشمي')).toBe('أا');
  });

  it('does not uppercase, because Arabic has no uppercase to reach for', () => {
    // A Latin name already capitalised stays as written; a lowercase one is
    // not forced, so the avatar always shows what the name actually says.
    expect(initialsFrom('ahmad hashimi')).toBe('ah');
  });

  it('handles a single-token name', () => {
    expect(initialsFrom('Cher')).toBe('C');
    expect(initialsFrom('أحمد')).toBe('أ');
  });

  it('survives an empty or whitespace-only name rather than throwing', () => {
    expect(initialsFrom('')).toBe('');
    expect(initialsFrom('   ')).toBe('');
  });

  it('collapses the non-breaking and zero-width separators Arabic text carries', () => {
    expect(initialsFrom('أحمد الهاشمي')).toBe('أا');
    expect(initialsFrom('Branch​Manager')).toBe('BM');
  });

  it('does not split an astral character into a lone surrogate', () => {
    const out = initialsFrom('𝐀lpha 𝐁eta');
    expect(Array.from(out)).toHaveLength(2);
    expect(out).toBe('𝐀𝐁');
  });
});
