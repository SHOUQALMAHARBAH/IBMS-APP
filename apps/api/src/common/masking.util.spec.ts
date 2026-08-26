import { describe, expect, it } from 'vitest';
import { maskTrailing } from './masking.util';

describe('maskTrailing', () => {
  it('masks all but the last 4 characters by default', () => {
    expect(maskTrailing('9901234567')).toBe('******4567');
  });

  it('masks a value shorter than the visible suffix in full', () => {
    expect(maskTrailing('123')).toBe('***');
  });

  it('masks a value exactly the visible-suffix length in full', () => {
    expect(maskTrailing('1234')).toBe('****');
  });

  it('masks an empty string to an empty string', () => {
    expect(maskTrailing('')).toBe('');
  });

  it('honors a custom visible-suffix length', () => {
    expect(maskTrailing('4111111111111111', 4)).toBe('************1111');
    expect(maskTrailing('4111111111111111', 6)).toBe('**********111111');
  });

  it('never reveals more characters than requested even for long values', () => {
    const masked = maskTrailing('A'.repeat(100) + '9999', 4);
    expect(masked).toHaveLength(104);
    expect(masked.endsWith('9999')).toBe(true);
    expect(masked.slice(0, 100)).toBe('*'.repeat(100));
  });
});
