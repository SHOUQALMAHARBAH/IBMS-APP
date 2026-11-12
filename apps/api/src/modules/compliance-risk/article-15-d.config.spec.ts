import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';

import {
  ARTICLE_15_D_EXEMPTION_4_LINE_CODES,
  availableExemptions,
  exemption4Applies,
  quotationBreachesCeiling,
  reachesEnoughInsurers,
  type Article15DFigures,
} from './article-15-d.config';

/**
 * ART. 15/d's pure half. Each test names the DECISION CRITERION it proves, so the seven of
 * decision 129 §4 and the four of decision 130 §4 can be checked against this file rather than
 * against a summary of it. The criteria that need a database or a request live in
 * `apps/api/test/article-15-d.e2e-spec.ts`.
 *
 * The figures are PARAMETERS here, which is the whole point: they are `LegalValue` rows read at
 * the request's own date, and a function that read today's could not express criterion 4.
 */

/** The figures as the instrument states them today — art. 15/d and 15/d/4, printed page 17. */
const TODAY: Article15DFigures = {
  minInsurers: 3,
  premiumCeilingJod: new Decimal('2000'),
};

describe('reachesEnoughInsurers — the only question art. 15/d asks', () => {
  it('DECISION 130 CASE 2 — the count is of the SHORTLIST, and three is enough', () => {
    expect(reachesEnoughInsurers(3, TODAY)).toBe(true);
    expect(reachesEnoughInsurers(4, TODAY)).toBe(true);
  });

  it('fewer than three is not enough, including the empty shortlist', () => {
    expect(reachesEnoughInsurers(2, TODAY)).toBe(false);
    expect(reachesEnoughInsurers(1, TODAY)).toBe(false);
    expect(reachesEnoughInsurers(0, TODAY)).toBe(false);
  });

  it('reads the MINIMUM from the figures, so a changed row changes the answer', () => {
    // «التواصل مع ثلاث شركات» is a figure the instrument states and the provider owns. If the
    // Central Bank moved it to four, a request to three would stop being enough — and the only way
    // that can be true of this code is for the number to arrive as a parameter.
    const four: Article15DFigures = { ...TODAY, minInsurers: 4 };
    expect(reachesEnoughInsurers(3, four)).toBe(false);
    expect(reachesEnoughInsurers(4, four)).toBe(true);
  });
});

describe('availableExemptions — «والنظام يعرض الإعفاءات المتاحة فقط»', () => {
  it('DECISION 129 CRITERION 2 — the medical renewals are offered on the medical line', () => {
    const codes = availableExemptions('MEDICAL_HEALTH').map((o) => o.exemption);
    expect(codes).toContain('INDIVIDUAL_MEDICAL_RENEWAL');
    expect(codes).toContain('GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS');
  });

  it('DECISION 129 CRITERION 2, THE OTHER DIRECTION — change the line to non-medical and they go', () => {
    // «غيِّر الفرع إلى غير الطبي ⟶ يزول الوسم، وتظهر الإعفاءات المتاحة أو النافذة.» Offering a
    // *medical renewal* exemption on a motor request would be offering a reason that cannot be
    // true, which is worse than offering nothing.
    const codes = availableExemptions('MOTOR_COMPREHENSIVE').map(
      (o) => o.exemption,
    );
    expect(codes).not.toContain('INDIVIDUAL_MEDICAL_RENEWAL');
    expect(codes).not.toContain('GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS');
  });

  it('exemption 4 is offered on all four eligible line codes and on none other', () => {
    for (const code of ARTICLE_15_D_EXEMPTION_4_LINE_CODES) {
      expect(
        availableExemptions(code).map((o) => o.exemption),
        `${code} should offer exemption 4`,
      ).toContain('LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT');
    }
    expect(
      availableExemptions('PROPERTY_ALL_RISKS').map((o) => o.exemption),
    ).not.toContain('LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT');
  });

  it('⛔ and `MONEY` does NOT offer exemption 4, though its own name says “in Transit”', () => {
    // "Money (Cash in Safe / in Transit)". Cash in transit is not GOODS in transit, and any match
    // on the words would widen a statutory exemption by substring. This is the test that stops
    // somebody "simplifying" the four-code list into a regex.
    expect(
      availableExemptions('MONEY').map((o) => o.exemption),
      'MONEY is cash in transit, not goods in transit — exemption 4 must not reach it',
    ).not.toContain('LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT');
  });

  it('exemptions 3 and 5 are offered on every line, including one the system does not know', () => {
    // 3 because the Central Bank has issued no defined-benefit list, so nothing can say a product
    // is NOT one; 5 because the customer's request is not a property of the line.
    for (const line of ['PROPERTY_ALL_RISKS', 'MEDICAL_HEALTH', null]) {
      const codes = availableExemptions(line).map((o) => o.exemption);
      expect(codes).toContain('DEFINED_BENEFIT_CONTRACT');
      expect(codes).toContain('AT_CUSTOMER_REQUEST');
    }
  });

  it('every offer carries a REASON, never a bare code', () => {
    // The screen shows a person why an exemption is on their list, and the report has to say why
    // one was available. An offer with an empty reason is a checkbox with no accountability.
    for (const offer of availableExemptions('MEDICAL_HEALTH')) {
      expect(offer.because.trim().length).toBeGreaterThan(20);
    }
  });

  it('a line the system cannot resolve offers the two ungated exemptions and no more', () => {
    // An RFQ can carry no resolved line FK — `managed-line-writers.e2e-spec.ts` pins that case for
    // a coverage string the config has no mapping for. The answer must be the UNGATED two, never
    // all five: a null line is not evidence that the line qualifies.
    const codes = availableExemptions(null).map((o) => o.exemption);
    expect(codes.sort()).toEqual(
      ['AT_CUSTOMER_REQUEST', 'DEFINED_BENEFIT_CONTRACT'].sort(),
    );
  });
});

describe('exemption4Applies — DECISION 129 CRITERION 3', () => {
  it('a premium AT the ceiling qualifies, because the article says «لا يزيد عن»', () => {
    expect(
      exemption4Applies('MOTOR_COMPREHENSIVE', new Decimal('2000'), TODAY),
      'an off-by-one here refuses a transaction the instrument permits',
    ).toBe(true);
  });

  it('a premium of 2001 does NOT — the criterion’s own figure', () => {
    expect(
      exemption4Applies('MOTOR_COMPREHENSIVE', new Decimal('2001'), TODAY),
    ).toBe(false);
  });

  it('and 2000.001 does not either, which a float comparison would get wrong', () => {
    // `money-decimal-jod.md`: JOD carries three decimals. This is the case that separates a Decimal
    // comparison from a float one, and it is the reason the column is Decimal(18,3).
    expect(
      exemption4Applies('MOTOR_COMPREHENSIVE', new Decimal('2000.001'), TODAY),
    ).toBe(false);
  });

  it('the ceiling comes from the FIGURES, so an old request keeps its own answer — CRITERION 4', () => {
    // «غيِّر سطر الـ٢٠٠٠ في الجدول بتاريخ نفاذ جديد ⟶ الطلب القديم يبقى على قيمته يوم أُرسل.»
    // Proven here on the pure function; the e2e proves the stored row keeps it too.
    const raised: Article15DFigures = {
      ...TODAY,
      premiumCeilingJod: new Decimal('3000'),
    };
    const premium = new Decimal('2500');
    expect(exemption4Applies('MOTOR_COMPREHENSIVE', premium, TODAY)).toBe(
      false,
    );
    expect(exemption4Applies('MOTOR_COMPREHENSIVE', premium, raised)).toBe(
      true,
    );
  });

  it('a non-eligible line never qualifies, whatever the premium', () => {
    expect(
      exemption4Applies('PROPERTY_ALL_RISKS', new Decimal('1'), TODAY),
    ).toBe(false);
  });

  it('a negative premium never qualifies — it is a different kind of fact, not a smaller number', () => {
    expect(
      exemption4Applies('MOTOR_COMPREHENSIVE', new Decimal('-1'), TODAY),
    ).toBe(false);
  });
});

describe('quotationBreachesCeiling — message 36 §4.5', () => {
  it('DECISION 130 CASE 3 — a quote of 2100 against a declared 1900 breaches a 2000 ceiling', () => {
    expect(
      quotationBreachesCeiling(new Decimal('2100'), new Decimal('2000')),
    ).toBe(true);
  });

  it('a quote exactly AT the ceiling does not breach it', () => {
    // Matching the database's own CHECK, and matching `exemption4Applies` above: at the ceiling is
    // inside it, in both directions. Two different answers to «لا يزيد عن» would be the drift.
    expect(
      quotationBreachesCeiling(new Decimal('2000'), new Decimal('2000')),
    ).toBe(false);
  });

  it('and nothing here refuses anything — it answers a comparison only', () => {
    // The function's return type is the proof: a boolean, not a throw. Decision 126's shape is
    // that the system WARNS and does not refuse, and the quotation is not rejected and the
    // exemption is not erased.
    expect(
      typeof quotationBreachesCeiling(new Decimal('9999'), new Decimal('1')),
    ).toBe('boolean');
  });
});
