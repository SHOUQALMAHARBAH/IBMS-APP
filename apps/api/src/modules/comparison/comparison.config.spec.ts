import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { planComparison } from './comparison.config';

const q = (id: string, insurerId: string, isCurrentVersion = true) => ({
  id,
  insurerId,
  isCurrentVersion,
});
const s = (insurerId: string, status = 'SENT') => ({ insurerId, status });

describe('planComparison', () => {
  it('builds one row per current-version quotation and ignores superseded ones', () => {
    const plan = planComparison(
      [q('q-1', 'ins-1'), q('q-0', 'ins-1', false), q('q-2', 'ins-2')],
      [s('ins-1', 'QUOTED'), s('ins-2', 'QUOTED')],
      [],
    );
    expect(plan.rows.map((r) => r.quotationId).sort()).toEqual(['q-1', 'q-2']);
    expect(plan.missingInsurerIds).toEqual([]);
    expect(plan.declinedInsurerIds).toEqual([]);
  });

  it('rejects a build with no current-version quotations', () => {
    expect(() =>
      planComparison([q('q-0', 'ins-1', false)], [s('ins-1')], []),
    ).toThrow(UnprocessableEntityException);
  });

  it('flags a shortlisted insurer with no quote as missing, a DECLINED one as declined', () => {
    const plan = planComparison(
      [q('q-1', 'ins-1')],
      [s('ins-1', 'QUOTED'), s('ins-2', 'NO_RESPONSE'), s('ins-3', 'DECLINED')],
      [],
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.missingInsurerIds).toEqual(['ins-2']);
    expect(plan.declinedInsurerIds).toEqual(['ins-3']);
  });

  it('attaches a normalized 2dp score to the matching row', () => {
    const plan = planComparison(
      [q('q-1', 'ins-1'), q('q-2', 'ins-2')],
      [s('ins-1', 'QUOTED'), s('ins-2', 'QUOTED')],
      [{ insurerId: 'ins-1', insurerQualityScore: '87.5', serviceScore: '90' }],
    );
    const scored = plan.rows.find((r) => r.quotationId === 'q-1');
    expect(scored?.insurerQualityScore).toBeInstanceOf(Prisma.Decimal);
    expect(scored?.insurerQualityScore?.toFixed(2)).toBe('87.50');
    expect(scored?.serviceScore?.toFixed(2)).toBe('90.00');
    const unscored = plan.rows.find((r) => r.quotationId === 'q-2');
    expect(unscored?.insurerQualityScore).toBeNull();
    expect(unscored?.serviceScore).toBeNull();
  });

  it('rejects a score for an insurer with no current quote', () => {
    expect(() =>
      planComparison(
        [q('q-1', 'ins-1')],
        [s('ins-1', 'QUOTED'), s('ins-2', 'DECLINED')],
        [{ insurerId: 'ins-2', insurerQualityScore: '80' }],
      ),
    ).toThrow(/no current quotation/);
  });

  it('rejects an out-of-range score', () => {
    expect(() =>
      planComparison(
        [q('q-1', 'ins-1')],
        [s('ins-1', 'QUOTED')],
        [{ insurerId: 'ins-1', serviceScore: '150' }],
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects a duplicate score for one insurer', () => {
    expect(() =>
      planComparison(
        [q('q-1', 'ins-1')],
        [s('ins-1', 'QUOTED')],
        [
          { insurerId: 'ins-1', serviceScore: '80' },
          { insurerId: 'ins-1', serviceScore: '90' },
        ],
      ),
    ).toThrow(/[Dd]uplicate/);
  });

  it('treats an empty-string score as null, not zero', () => {
    const plan = planComparison(
      [q('q-1', 'ins-1')],
      [s('ins-1', 'QUOTED')],
      [{ insurerId: 'ins-1', insurerQualityScore: '', serviceScore: '  ' }],
    );
    expect(plan.rows[0].insurerQualityScore).toBeNull();
    expect(plan.rows[0].serviceScore).toBeNull();
  });
});
