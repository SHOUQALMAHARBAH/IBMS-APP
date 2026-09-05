import { describe, expect, it } from 'vitest';
import { hasExactlyOneOwner } from './dto.util';

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
