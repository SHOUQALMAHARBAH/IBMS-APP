import { describe, expect, it } from 'vitest';
import { expandSearchTerms } from './name-transliteration.config';

describe('expandSearchTerms', () => {
  it('expands a Latin given name to its Arabic spelling(s)', () => {
    const variants = expandSearchTerms('Ahmad');
    expect(variants).toContain('أحمد');
    expect(variants).toContain('احمد');
    expect(variants).not.toContain('ahmad'); // never the input itself
  });

  it('expands an Arabic given name to its Latin spelling variants', () => {
    const variants = expandSearchTerms('أحمد');
    expect(variants).toContain('ahmad');
    expect(variants).toContain('ahmed');
  });

  it('is case-insensitive on the Latin side', () => {
    expect(expandSearchTerms('AHMAD')).toContain('أحمد');
    expect(expandSearchTerms('AhMaD')).toContain('أحمد');
  });

  it('matches the hamza-dropped Arabic spelling too', () => {
    // "احمد" (no hamza) is how many people type this name casually.
    const variants = expandSearchTerms('احمد');
    expect(variants).toContain('ahmad');
    expect(variants).toContain('أحمد');
  });

  it('strips Arabic diacritics before lookup', () => {
    const variants = expandSearchTerms('أَحْمَد');
    expect(variants).toContain('ahmad');
  });

  it('expands only the matching word in a multi-word term, leaving the rest alone', () => {
    const variants = expandSearchTerms('Khaled Trading Co.');
    expect(variants).toContain('khalid');
    expect(variants).toContain('خالد');
    expect(variants.some((v) => v.includes('Trading'))).toBe(false);
  });

  it('returns an empty array for a name with no known variant', () => {
    expect(expandSearchTerms('Zzznomatch12345')).toEqual([]);
  });

  it('returns an empty array for an empty or whitespace-only term', () => {
    expect(expandSearchTerms('')).toEqual([]);
    expect(expandSearchTerms('   ')).toEqual([]);
  });

  it('never returns a duplicate variant', () => {
    const variants = expandSearchTerms('Mohammed Muhammad');
    const unique = new Set(variants);
    expect(variants.length).toBe(unique.size);
  });
});
