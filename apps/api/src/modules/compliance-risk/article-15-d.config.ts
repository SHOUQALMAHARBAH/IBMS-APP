import type { Article15DExemption, LegalValue } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { requireNumeric, requireWholeNumber } from './legal-figures.config';

/**
 * ART. 15/d — A QUOTE REQUEST MUST REACH THREE INSURANCE COMPANIES OR MORE.
 *
 * Pure functions. No database, no clock, no I/O — the figures and the date are PARAMETERS, which
 * is what makes decision 129's criterion 4 testable: an old request is evaluated against the
 * figures that were in force on ITS day, and a function that read today's could not express that.
 *
 * ## THE TWO FIGURES ARE NOT LITERALS AND MUST NEVER BECOME ONE
 *
 * Both are rows in the legal-values table, seeded with their article and the printed page they
 * were read on (OWNER DECISION 123, third form):
 *
 *   `MIN_INSURERS_PER_REQUEST`                      art. 15/d    page 17   3
 *   `SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD`  art. 15/d/4  page 17   2000
 *
 * `Article15DFigures` is REQUIRED with no default, so the compiler asks every call site where its
 * figures came from. A default of three would make a refusal correct by coincidence, and
 * `check:legal-numbers` would flag the literal besides.
 */
export interface Article15DFigures {
  /** `MIN_INSURERS_PER_REQUEST`, read at the request's own date. */
  minInsurers: number;
  /** `SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD`, read at the request's own date. */
  premiumCeilingJod: Decimal;
}

/** The two codes, in one place, so a caller never writes the string either. */
export const ARTICLE_15_D_LEGAL_VALUE_CODES = {
  minInsurers: 'MIN_INSURERS_PER_REQUEST',
  premiumCeiling: 'SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD',
} as const;

/**
 * Build the figures from `LegalValue` rows ALREADY READ AT THE RIGHT DATE.
 *
 * Takes the rows rather than the repository, so the rule is testable with no database — the split
 * `licenceFiguresFrom` keeps, and for the same reason. The readers are imported from
 * `legal-figures.config.ts` rather than copied: a MISSING figure is a refusal naming the code and
 * never a default, and a count with a fractional part is refused rather than truncated. A default
 * of three would make a refusal correct by coincidence.
 */
export function article15DFiguresFrom(
  rows: readonly LegalValue[],
): Article15DFigures {
  return {
    minInsurers: requireWholeNumber(
      rows,
      ARTICLE_15_D_LEGAL_VALUE_CODES.minInsurers,
    ),
    premiumCeilingJod: requireNumeric(
      rows,
      ARTICLE_15_D_LEGAL_VALUE_CODES.premiumCeiling,
    ),
  };
}

/**
 * THE INSURANCE LINES EXEMPTION 4 CAN APPLY TO — «مركبات أو طبي أو بضائع».
 *
 * FOUR CODES FOR THREE WORDS, measured against the 32-row catalogue on 2026-11-12:
 *
 *   motor            `MOTOR_COMPREHENSIVE`, `MOTOR_TPL_COMPULSORY`   (the article says the kind,
 *                                                                     the catalogue splits it)
 *   medical          `MEDICAL_HEALTH`
 *   goods in transit `MARINE_CARGO`
 *
 * ⛔ AND `MONEY` IS DELIBERATELY NOT IN THIS LIST, which is the trap worth naming: its name is
 * "Money (Cash in Safe / in Transit)", so any match on the words "in transit" sweeps it in. Cash
 * in transit is not GOODS in transit, and admitting it would widen a statutory exemption by a
 * substring match.
 */
export const ARTICLE_15_D_EXEMPTION_4_LINE_CODES: readonly string[] = [
  'MOTOR_COMPREHENSIVE',
  'MOTOR_TPL_COMPULSORY',
  'MEDICAL_HEALTH',
  'MARINE_CARGO',
];

/** The medical line, which is what exemptions 1 and 2 depend on. ONE code, and that single row is
 *  the whole reason neither can be tagged by the system: there is no individual/group split. */
export const ARTICLE_15_D_MEDICAL_LINE_CODE = 'MEDICAL_HEALTH';

export interface ExemptionOffer {
  exemption: Article15DExemption;
  /** Why it is offered, for the screen and for the report — never a bare list. */
  because: string;
}

/**
 * WHICH OF THE FIVE MAY BE OFFERED for a request on this line.
 *
 * Decision 129: «والنظام يعرض الإعفاءات المتاحة فقط» — the system offers only the available ones.
 * An exemption is available when it COULD apply; whether it DOES is the employee's declaration,
 * because on the 2026-11-12 measurement not one of the five is a fact the system holds.
 *
 * ## WHAT GATES WHAT, AND WHICH PART IS A READING RATHER THAN A RULE
 *
 *   1, 2  GATED ON THE MEDICAL LINE. Decision 129's criterion 2 — «غيِّر الفرع إلى غير الطبي ⟶
 *         يزول الوسم» — makes the line the discriminator, and offering a *medical renewal*
 *         exemption on a motor request would be offering a reason that cannot be true.
 *   3     NOT GATED. ⚠️ THIS IS A READING AND IT IS STATED AS ONE: the defined-benefit list is
 *         `DEFINED_BENEFIT_CONTRACT_LIST`, seeded with its shape and NO value because the Central
 *         Bank has issued none. With no list, nothing can say a product is NOT defined-benefit —
 *         so withholding the exemption would be the system asserting a fact it does not have,
 *         which is the opposite error from offering it. The day the list arrives, this becomes a
 *         lookup and the exemption becomes taggable.
 *   4     GATED ON THE LINE **AND** THE PREMIUM — see `exemption4Applies`.
 *   5     NOT GATED. The customer's request is not a property of the line, and the evidence is
 *         what makes it real: the database refuses the row without it (criterion 5).
 */
export function availableExemptions(lineCode: string | null): ExemptionOffer[] {
  const offers: ExemptionOffer[] = [];

  if (lineCode === ARTICLE_15_D_MEDICAL_LINE_CODE) {
    offers.push({
      exemption: 'INDIVIDUAL_MEDICAL_RENEWAL',
      because:
        'the request is on the medical line, so an individual medical renewal is possible — whether this request IS one is the declaration',
    });
    offers.push({
      exemption: 'GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS',
      because:
        'the request is on the medical line, so a group medical renewal is possible — the three-consecutive-year limit is part of the declaration, because the consecutive count is not recorded anywhere',
    });
  }

  offers.push({
    exemption: 'DEFINED_BENEFIT_CONTRACT',
    because:
      'the Central Bank has issued no defined-benefit list, so the system cannot say a product is not one — the declaration is the only available answer',
  });

  if (
    lineCode !== null &&
    ARTICLE_15_D_EXEMPTION_4_LINE_CODES.includes(lineCode)
  ) {
    offers.push({
      exemption: 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
      because:
        'the line is motor, medical or goods in transit, so the premium ceiling can be tested — the expected annual premium is entered with the choice',
    });
  }

  offers.push({
    exemption: 'AT_CUSTOMER_REQUEST',
    because:
      'the customer may have asked for it; the evidence of that request is stored with the exemption and the database refuses it without one',
  });

  return offers;
}

/**
 * DECISION 129's CRITERION 3, as one function: «قسط ٢٠٠١ في المركبات ⟶ الإعفاء الرابع لا يُعرَض.
 * وقسط ٢٠٠٠ ⟶ يُعرَض اختياراً.»
 *
 * AT the ceiling is INSIDE it. The article says «لا يزيد عن ٢٠٠٠» — does not EXCEED 2000 — so 2000
 * qualifies and 2001 does not. An off-by-one here refuses a transaction the instrument permits,
 * which is the direction that costs the office business for no legal reason.
 *
 * `Decimal` comparison, never a float: `money-decimal-jod.md`. `2000.001` is above the ceiling and
 * a float comparison is exactly where that stops being true.
 */
export function exemption4Applies(
  lineCode: string | null,
  declaredAnnualPremiumJod: Decimal,
  figures: Article15DFigures,
): boolean {
  if (lineCode === null) return false;
  if (!ARTICLE_15_D_EXEMPTION_4_LINE_CODES.includes(lineCode)) return false;
  if (declaredAnnualPremiumJod.isNegative()) return false;
  return declaredAnnualPremiumJod.lessThanOrEqualTo(figures.premiumCeilingJod);
}

/**
 * HOW MANY INSURERS IS ENOUGH — the only question art. 15/d actually asks.
 *
 * «التواصل مع ثلاث شركات» is THE SENDING, not receiving three replies — the owner's reading of
 * 9 October, carried forward unchanged by OWNER DECISION 129 §3 — so the count is of the shortlist
 * the request went to and nothing about the responses.
 *
 * ⟶ ATTRIBUTED THE WAY `seed-data/legal-values.ts` ALREADY ATTRIBUTES IT, and that is deliberate.
 * The first version of this comment cited the 9 October ruling BY ITS OWN NUMBER, and
 * `check:decision-index` refused it — that ruling has no file in `docs/`. The fix is not to declare
 * it missing: the RULE's home is OWNER DECISION 129 §3, which restates it under «ما يبقى من قرار ٩
 * تشرين الأول كما هو» — *what remains from the 9 October decision unchanged* — so naming 129 loses
 * no attribution at all. Writing a decision file is the owner's, and a citation that points nowhere
 * is worse than citing the decision that carries the rule today.
 *
 * ⛔ AND THE NUMBER IS NOT REPEATED ANYWHERE IN THIS FILE, INCLUDING HERE. The gate WALKS a
 * multi-number citation, so a comment that names the number while explaining why it must not be
 * named is itself the citation — which is exactly what the second version of this comment did.
 */
export function reachesEnoughInsurers(
  insurerCount: number,
  figures: Article15DFigures,
): boolean {
  return insurerCount >= figures.minInsurers;
}

/**
 * Does a quotation that has come back breach the ceiling the exemption was recorded under?
 *
 * Message 36 §4.5: it WARNS and does not refuse, and does not erase the exemption. This function
 * only answers the comparison; `Article15DPremiumAlert` is where the answer is recorded, and
 * nothing here refuses anything.
 *
 * STRICTLY GREATER, matching the database's own
 * `Article15DPremiumAlert_is_actually_above_the_ceiling`: a quote exactly AT the ceiling is within
 * it, for the same reason 2000 qualifies above.
 */
export function quotationBreachesCeiling(
  quotedPremiumJod: Decimal,
  ceilingValueJod: Decimal,
): boolean {
  return quotedPremiumJod.greaterThan(ceilingValueJod);
}
