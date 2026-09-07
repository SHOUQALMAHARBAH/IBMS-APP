import { describe, expect, it } from 'vitest';
import { BENCHMARK_LINES, findCoverageGaps } from './cross-sell.config';

describe('findCoverageGaps', () => {
  it('returns no gaps when the customer holds every benchmark line', () => {
    expect(findCoverageGaps([...BENCHMARK_LINES])).toEqual([]);
  });

  it('returns the whole benchmark when the customer holds nothing', () => {
    expect(findCoverageGaps([])).toEqual([...BENCHMARK_LINES]);
  });

  it('returns only the missing benchmark lines', () => {
    expect(
      findCoverageGaps(['Property All Risks', 'Public Liability']),
    ).toEqual(['Business Interruption', 'Workers Compensation']);
  });

  it('is case- and whitespace-insensitive against a free-text held line', () => {
    expect(
      findCoverageGaps([
        '  property all risks ',
        'PUBLIC  LIABILITY',
        'business interruption',
        'workers compensation',
      ]),
    ).toEqual([]);
  });

  it('ignores a held line that is not part of the benchmark', () => {
    // Holding Motor Fleet is not a gap and must not suppress a real one.
    expect(findCoverageGaps(['Motor Fleet'])).toEqual([...BENCHMARK_LINES]);
  });

  it('returns gaps in BENCHMARK_LINES declaration order regardless of held-line order', () => {
    expect(
      findCoverageGaps(['Workers Compensation', 'Business Interruption']),
    ).toEqual(['Property All Risks', 'Public Liability']);
  });

  it('accepts a caller-supplied benchmark list', () => {
    expect(findCoverageGaps(['Cyber'], ['Cyber', 'Group Medical'])).toEqual([
      'Group Medical',
    ]);
  });
});
