import { Prisma } from '@ibms/db';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  applyPercentage,
  compareMoney,
  formatMoney,
  isZeroMoney,
  MONEY_PRECISION,
  MONEY_ROUNDING,
  MONEY_SCALE,
  quantizeMoney,
  subtractMoney,
  sumMoney,
  toMoney,
} from './money.util';

describe('money.util constants', () => {
  it('matches the schema.prisma money column shape: Decimal(18, 3)', () => {
    expect(MONEY_PRECISION).toBe(18);
    expect(MONEY_SCALE).toBe(3);
  });

  it('fixes the rounding mode to ROUND_HALF_UP', () => {
    expect(MONEY_ROUNDING).toBe(Prisma.Decimal.ROUND_HALF_UP);
  });

  it('applies the fixed rounding mode as the Prisma.Decimal global default too', () => {
    // Belt-and-suspenders: any Decimal arithmetic elsewhere that rounds an
    // intermediate result implicitly (e.g. a repeating-decimal division)
    // without passing a mode still lands on the same fixed mode.
    expect(Prisma.Decimal.rounding).toBe(MONEY_ROUNDING);
  });
});

describe('toMoney', () => {
  it('accepts a decimal string', () => {
    expect(toMoney('19.990').toString()).toBe('19.99');
  });

  it('accepts a Prisma.Decimal and returns it as-is', () => {
    const d = new Prisma.Decimal('5.5');
    expect(toMoney(d)).toBe(d);
  });

  it('accepts an exact-integer JS number', () => {
    expect(toMoney(100).toString()).toBe('100');
    expect(toMoney(0).toString()).toBe('0');
  });

  it('rejects a fractional JS number, naming the offending value', () => {
    expect(() => toMoney(19.99, 'Policy.issue')).toThrow(
      /Policy\.issue.*19\.99/s,
    );
  });

  it('rejects a fractional JS number even when it looks "round" in decimal but is not exactly representable', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754 — exactly the failure mode this guards against.
    expect(() => toMoney(0.1 + 0.2)).toThrow(/non-integer JS number/);
  });
});

describe('quantizeMoney', () => {
  it('rounds half-up at the third decimal place (not half-even)', () => {
    // 10.1225 -> HALF_UP: 10.123; HALF_EVEN would give 10.122 — this
    // distinguishes the two modes, not just "rounds to 3dp somehow".
    expect(quantizeMoney('10.1225').toString()).toBe('10.123');
  });

  it('leaves an already-quantized value unchanged', () => {
    expect(quantizeMoney('10.123').toString()).toBe('10.123');
  });

  it('quantizes a repeating decimal from division', () => {
    expect(quantizeMoney(new Prisma.Decimal(10).dividedBy(3)).toString()).toBe(
      '3.333',
    );
  });
});

describe('addMoney', () => {
  it('sums multiple amounts and quantizes once at the end', () => {
    expect(addMoney('10.1111', '0.0004').toString()).toBe('10.112');
  });

  it('sums a mix of strings, Decimals, and integer numbers', () => {
    expect(addMoney('1.500', new Prisma.Decimal('2.250'), 3).toString()).toBe(
      '6.75',
    );
  });

  it('throws with no arguments rather than silently returning zero', () => {
    expect(() => addMoney()).toThrow(/at least one value/);
  });
});

describe('sumMoney', () => {
  it('sums a list (no spread) and quantizes once', () => {
    expect(
      sumMoney(['10.1111', '0.0004', new Prisma.Decimal('1.000')]).toString(),
    ).toBe('11.112');
  });

  it('is a clean zero for an empty list (a sum over nothing), never a throw', () => {
    expect(sumMoney([]).toString()).toBe('0');
  });

  it('handles a list far longer than a safe spread would allow', () => {
    const many = Array.from({ length: 200_000 }, () => '0.001');
    expect(sumMoney(many).toString()).toBe('200');
  });
});

describe('subtractMoney', () => {
  it('subtracts a single amount', () => {
    expect(subtractMoney('100.000', '25.555').toString()).toBe('74.445');
  });

  it('subtracts multiple amounts left to right', () => {
    expect(subtractMoney('100', '10', '20', '5').toString()).toBe('65');
  });

  it('can go negative — a real outcome for e.g. a variance amount', () => {
    expect(subtractMoney('10', '25').toString()).toBe('-15');
  });
});

describe('applyPercentage', () => {
  it('applies an illustrative Motor commission rate (12%) to a premium', () => {
    // Part 3.6 illustrative rate table.
    expect(applyPercentage('1000.500', '12').toString()).toBe('120.06');
  });

  it('rounds the result to fils precision, half-up', () => {
    // 33.335 * 12.5% = 4.166875 -> half-up at 3dp -> 4.167
    expect(applyPercentage('33.335', '12.5').toString()).toBe('4.167');
  });

  it('applies a zero rate to zero', () => {
    expect(applyPercentage('0', '0').toString()).toBe('0');
  });
});

describe('isZeroMoney', () => {
  it('is true for zero in any input form', () => {
    expect(isZeroMoney('0')).toBe(true);
    expect(isZeroMoney('0.000')).toBe(true);
    expect(isZeroMoney(0)).toBe(true);
  });

  it('is false for a non-zero amount', () => {
    expect(isZeroMoney('0.001')).toBe(false);
  });
});

describe('compareMoney', () => {
  it('returns -1, 0, 1 for less-than, equal, greater-than', () => {
    expect(compareMoney('1.000', '2.000')).toBe(-1);
    expect(compareMoney('2.000', '2.000')).toBe(0);
    expect(compareMoney('2.000', '1.000')).toBe(1);
  });

  it('treats differently-formatted equal amounts as equal', () => {
    expect(compareMoney('2', '2.000')).toBe(0);
  });
});

describe('formatMoney', () => {
  it('always renders exactly three decimal places', () => {
    expect(formatMoney('5')).toBe('5.000');
    expect(formatMoney('5.5')).toBe('5.500');
    expect(formatMoney('5.5551')).toBe('5.555');
  });
});
