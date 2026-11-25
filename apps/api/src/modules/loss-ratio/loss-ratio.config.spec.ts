import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  buildLossRatioBreakdown,
  computeLossRatio,
  lossRatioAuditSnapshot,
  type AnalyticsPolicyLike,
  type LossRatioBreakdownRow,
} from './loss-ratio.config';

const d = (s: string) => new Prisma.Decimal(s);

function pol(over: Partial<AnalyticsPolicyLike>): AnalyticsPolicyLike {
  return {
    id: 'pol-1',
    customerId: 'cus-1',
    customerLegalName: 'Acme Ltd',
    insuranceLine: 'Property All Risks',
    // Genuinely different from the Latin names beside them, so an assertion that reads one
    // cannot pass against a build that returned the other.
    insuranceLineAr: 'تأمين جميع أخطار الممتلكات',
    insurerId: 'ins-1',
    insurerName: 'National Insurance',
    insurerNameAr: 'شركة التأمين الوطنية',
    policyRef: 'POL-1',
    premium: d('10000.000'),
    claimNetSettlements: [],
    ...over,
  };
}

describe('computeLossRatio (Process 29)', () => {
  it('sums the net settlements and divides by the premium (worked example)', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('15000.000'), d('5000.000')],
      periodPremium: d('40000.000'),
    });
    expect(f.periodClaims.toFixed(3)).toBe('20000.000');
    expect(f.periodPremium.toFixed(3)).toBe('40000.000');
    expect(f.ratio.toFixed(4)).toBe('0.5000');
  });

  it('is zero claims / zero ratio when the policy has no settled claims', () => {
    const f = computeLossRatio({
      claimNetSettlements: [],
      periodPremium: d('10000.000'),
    });
    expect(f.periodClaims.toFixed(3)).toBe('0.000');
    expect(f.ratio.toFixed(4)).toBe('0.0000');
  });

  it('ignores null net settlements (an unsettled claim contributes nothing)', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('1200.000'), null, d('300.000')],
      periodPremium: d('3000.000'),
    });
    expect(f.periodClaims.toFixed(3)).toBe('1500.000');
    expect(f.ratio.toFixed(4)).toBe('0.5000');
  });

  it('quantizes the ratio to 4 dp with ROUND_HALF_UP', () => {
    // 1000 / 3000 = 0.33333... -> 0.3333
    const f = computeLossRatio({
      claimNetSettlements: [d('1000.000')],
      periodPremium: d('3000.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('0.3333');
  });

  it('yields a zero ratio (never a divide-by-zero) when the premium is zero', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('500.000')],
      periodPremium: d('0.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('0.0000');
    expect(f.ratioCapped).toBe(false);
  });

  it('caps the ratio at 999.9999 (the Decimal(7,4) column max) and flags it', () => {
    // 5,000,000 claims against a 1,000 premium -> 5000.0000, over the column max
    const f = computeLossRatio({
      claimNetSettlements: [d('5000000.000')],
      periodPremium: d('1000.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('999.9999');
    expect(f.ratioCapped).toBe(true);
  });

  it('does not flag a ratio that fits the column', () => {
    const f = computeLossRatio({
      claimNetSettlements: [d('12000.000')],
      periodPremium: d('10000.000'),
    });
    expect(f.ratio.toFixed(4)).toBe('1.2000');
    expect(f.ratioCapped).toBe(false);
  });
});

describe('lossRatioAuditSnapshot', () => {
  it('carries ids + the three figures as fixed strings + the trigger, no narrative', () => {
    const snap = lossRatioAuditSnapshot({
      lossRatioId: 'lr-1',
      renewalCaseId: 'rc-1',
      policyId: 'pol-1',
      trigger: 'claim-closed',
      claimId: 'claim-1',
      figures: computeLossRatio({
        claimNetSettlements: [d('15000.000')],
        periodPremium: d('30000.000'),
      }),
    });
    expect(snap).toEqual({
      lossRatioId: 'lr-1',
      renewalCaseId: 'rc-1',
      policyId: 'pol-1',
      trigger: 'claim-closed',
      claimId: 'claim-1',
      periodClaims: '15000.000',
      periodPremium: '30000.000',
      ratio: '0.5000',
      ratioCapped: false,
    });
  });
});

describe('buildLossRatioBreakdown (Process 30)', () => {
  const policies: AnalyticsPolicyLike[] = [
    // Acme — 2 policies, different lines
    pol({
      id: 'p-a1',
      customerId: 'acme',
      customerLegalName: 'Acme Ltd',
      policyRef: 'POL-A1',
      insuranceLine: 'Property All Risks',
      premium: d('40000.000'),
      claimNetSettlements: [d('15000.000'), d('5000.000'), null], // 20000 paid
    }),
    pol({
      id: 'p-a2',
      customerId: 'acme',
      customerLegalName: 'Acme Ltd',
      policyRef: 'POL-A2',
      insuranceLine: 'Motor Fleet',
      premium: d('10000.000'),
      claimNetSettlements: [], // no settled claims
    }),
    // Beta — 1 property policy, a big loss, placed with a different insurer
    pol({
      id: 'p-b1',
      customerId: 'beta',
      customerLegalName: 'Beta Co',
      policyRef: 'POL-B1',
      insuranceLine: 'Property All Risks',
      insurerId: 'ins-2',
      insurerName: 'Gulf Insurance',
      premium: d('20000.000'),
      claimNetSettlements: [d('30000.000')], // 30000 paid on 20000 premium -> 1.5
    }),
  ];

  it('groups by customer: one row per customer, pooled claims / premium, worst-first', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'customer', policies });
    expect(b.groupBy).toBe('customer');
    expect(b.rows.map((r) => r.key)).toEqual(['beta', 'acme']); // 1.5 before 0.4
    const acme = b.rows.find((r) => r.key === 'acme')!;
    expect(acme).toMatchObject({
      label: 'Acme Ltd',
      periodClaims: '20000.000',
      periodPremium: '50000.000', // 40000 + 10000
      ratio: '0.4000',
      claimCount: 2,
      policyCount: 2,
    });
    const beta = b.rows.find((r) => r.key === 'beta')!;
    expect(beta).toMatchObject({
      periodClaims: '30000.000',
      periodPremium: '20000.000',
      ratio: '1.5000',
      claimCount: 1,
      policyCount: 1,
    });
  });

  it('groups by line: pools across customers', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'line', policies });
    const property = b.rows.find((r) => r.key === 'Property All Risks')!;
    expect(property).toMatchObject({
      label: 'Property All Risks',
      periodClaims: '50000.000', // 20000 (Acme) + 30000 (Beta)
      periodPremium: '60000.000', // 40000 + 20000
      ratio: '0.8333', // 50000 / 60000
      claimCount: 3,
      policyCount: 2,
    });
    const motor = b.rows.find((r) => r.key === 'Motor Fleet')!;
    expect(motor).toMatchObject({
      ratio: '0.0000',
      claimCount: 0,
      policyCount: 1,
    });
  });

  it('groups by policy: one row per policy', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'policy', policies });
    expect(b.rows).toHaveLength(3);
    expect(b.rows.find((r) => r.key === 'p-a1')).toMatchObject({
      label: 'POL-A1',
      ratio: '0.5000', // 20000 / 40000
    });
  });

  it('groups by insurer (Part E Claims Dashboard, backlog #64): pools across customers', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'insurer', policies });
    expect(b.groupBy).toBe('insurer');
    expect(b.rows.map((r) => r.key)).toEqual(['ins-2', 'ins-1']); // 1.5 before 0.4
    const national = b.rows.find((r) => r.key === 'ins-1')!;
    expect(national).toMatchObject({
      label: 'National Insurance',
      periodClaims: '20000.000', // both Acme policies
      periodPremium: '50000.000',
      ratio: '0.4000',
      policyCount: 2,
    });
    const gulf = b.rows.find((r) => r.key === 'ins-2')!;
    expect(gulf).toMatchObject({
      label: 'Gulf Insurance',
      periodClaims: '30000.000',
      periodPremium: '20000.000',
      ratio: '1.5000',
      policyCount: 1,
    });
  });

  it('totals pool every policy regardless of groupBy', () => {
    const byCustomer = buildLossRatioBreakdown({
      groupBy: 'customer',
      policies,
    });
    const byLine = buildLossRatioBreakdown({ groupBy: 'line', policies });
    // 50000 claims / 70000 premium -> 0.7143
    expect(byCustomer.totals).toMatchObject({
      periodClaims: '50000.000',
      periodPremium: '70000.000',
      ratio: '0.7143',
      claimCount: 3,
      policyCount: 3,
    });
    expect(byLine.totals).toEqual(byCustomer.totals);
  });

  it('is an empty breakdown (zero totals) when no policies match', () => {
    const b = buildLossRatioBreakdown({ groupBy: 'customer', policies: [] });
    expect(b.rows).toEqual([]);
    expect(b.totals).toMatchObject({
      periodClaims: '0.000',
      periodPremium: '0.000',
      ratio: '0.0000',
      claimCount: 0,
      policyCount: 0,
    });
  });

  /* ============================================================================================
   * Contents §أ row ١١ — THE ARABIC NAME TRAVELS WITH THE GROUP, AND NO FIGURE MOVES.
   * ========================================================================================== */

  it('§أ-١١ — the by-insurer and by-line labels carry the Arabic name', () => {
    const policies = [
      pol({ id: 'p-1', premium: d('10000.000') }),
      pol({ id: 'p-2', premium: d('5000.000') }),
    ];

    const byInsurer = buildLossRatioBreakdown({ groupBy: 'insurer', policies });
    expect(byInsurer.rows).toHaveLength(1);
    expect(byInsurer.rows[0].label).toBe('National Insurance');
    expect(byInsurer.rows[0].labelAr).toBe('شركة التأمين الوطنية');

    const byLine = buildLossRatioBreakdown({ groupBy: 'line', policies });
    expect(byLine.rows).toHaveLength(1);
    expect(byLine.rows[0].label).toBe('Property All Risks');
    expect(byLine.rows[0].labelAr).toBe('تأمين جميع أخطار الممتلكات');
  });

  /**
   * ⛔ `customer` AND `policy` ARE NULL BY SCOPE, AND THAT IS ASSERTED RATHER THAN LEFT TO A
   * READER. The owner's row names the insurer and the line. Widening the by-language rule to
   * customer names reaches 20 sites she has ruled nothing about (measured, message 50), and a
   * policy reference is an ASCII code with no Arabic form at all.
   *
   * Non-vacuous by construction: the fixture CARRIES both Arabic names, so a build that leaked
   * one into these groupings would fail here rather than pass over an empty fixture.
   */
  it('§أ-١١ — the by-customer and by-policy labels carry NO Arabic name', () => {
    const policies = [pol({})];
    expect(
      buildLossRatioBreakdown({ groupBy: 'customer', policies }).rows[0].labelAr,
    ).toBeNull();
    expect(
      buildLossRatioBreakdown({ groupBy: 'policy', policies }).rows[0].labelAr,
    ).toBeNull();
  });

  /**
   * 🔴 ONE STORED LINE STRING, TWO ARABIC NAMES ⟶ THE ENGLISH, NOT EITHER OF THEM.
   *
   * The by-line group key is the stored string while the Arabic name comes from the line FK, so
   * this is reachable in the schema. ⛔ Picking one would label the whole group with a name
   * belonging to part of it, and WHICH one would depend on the planner's window.
   */
  it('§أ-١١ — a line group whose rows disagree about the Arabic name takes none', () => {
    const policies = [
      pol({ id: 'p-1', insuranceLineAr: 'تأمين المركبات الشامل' }),
      pol({ id: 'p-2', insuranceLineAr: 'تأمين الحياة الجماعي' }),
    ];
    const byLine = buildLossRatioBreakdown({ groupBy: 'line', policies });
    expect(byLine.rows[0].label).toBe('Property All Risks');
    expect(byLine.rows[0].labelAr).toBeNull();
  });

  /**
   * 🔴 AND EVERY FIGURE READS EXACTLY AS BEFORE — the message's own requirement, asserted as an
   * INVARIANCE rather than as a snapshot of one dataset.
   *
   * The same policies are run twice, once carrying both Arabic names and once with both nulled,
   * and every field but `labelAr` must be deeply equal — keys, labels, claims, premium, ratio,
   * the cap flag, both counts, the ordering and the totals. A snapshot would pin the figures for
   * the fixture it was written against; this pins them for the whole function, so no later edit
   * can let a name reach an amount.
   */
  it('§أ-١١ — the Arabic names cannot move any figure, in any grouping', () => {
    const withAr = [
      pol({
        id: 'p-1',
        premium: d('10000.000'),
        claimNetSettlements: [d('4000.000')],
      }),
      pol({
        id: 'p-2',
        customerId: 'cus-2',
        customerLegalName: 'Beta Co',
        insuranceLine: 'Motor Fleet',
        insuranceLineAr: 'تأمين المركبات الشامل',
        insurerId: 'ins-2',
        insurerName: 'Gulf Insurance',
        insurerNameAr: 'شركة الخليج للتأمين',
        policyRef: 'POL-2',
        premium: d('6000.000'),
        claimNetSettlements: [d('9000.000')],
      }),
    ];
    const withoutAr = withAr.map((p) => ({
      ...p,
      insuranceLineAr: null,
      insurerNameAr: null,
    }));

    for (const groupBy of ['customer', 'policy', 'insurer', 'line'] as const) {
      const a = buildLossRatioBreakdown({ groupBy, policies: withAr });
      const b = buildLossRatioBreakdown({ groupBy, policies: withoutAr });
      // ⚠️ The new field is NORMALISED to null on both sides rather than destructured away. Two
      // reasons: `({ labelAr: _a, ...rest })` leaves an unused binding, and this project
      // configures NO `varsIgnorePattern`, so even `_a` is an eslint error (message 45 §27); and
      // normalising compares the key's PRESENCE too, where dropping it could not.
      const figuresOnly = (r: LossRatioBreakdownRow) => ({
        ...r,
        labelAr: null,
      });
      expect(a.totals).toEqual(b.totals);
      expect(a.rows.map(figuresOnly)).toEqual(b.rows.map(figuresOnly));
    }

    // Non-vacuity: the two runs really do differ somewhere, or the loop above proves nothing.
    expect(
      buildLossRatioBreakdown({ groupBy: 'line', policies: withAr }).rows.map(
        (r) => r.labelAr,
      ),
    ).not.toEqual(
      buildLossRatioBreakdown({
        groupBy: 'line',
        policies: withoutAr,
      }).rows.map((r) => r.labelAr),
    );
  });

  it('propagates the ratio cap into a group row', () => {
    const b = buildLossRatioBreakdown({
      groupBy: 'policy',
      policies: [
        pol({
          id: 'p-huge',
          premium: d('1000.000'),
          claimNetSettlements: [d('5000000.000')],
        }),
      ],
    });
    expect(b.rows[0]).toMatchObject({ ratio: '999.9999', ratioCapped: true });
    expect(b.totals.ratioCapped).toBe(true);
  });
});
