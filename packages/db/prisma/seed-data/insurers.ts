/**
 * Part B — "sample insurers". Fictional insurer master data (Part 4.1 /
 * narrative process 31) covering the four lines named in the backlog item
 * (motor/general/health/life), so RFQ/quotation/policy work can be
 * exercised against a realistic-shaped `Insurer` without real insurer data.
 * Names are deliberately marked "(Sample)" so nobody mistakes these for a
 * real Jordanian insurer record. Seeding is gated on
 * `NODE_ENV !== 'production'` in seed.ts — see sample-users.ts for why.
 */
export interface SampleInsurerProductSeed {
  insuranceLine: string;
  productName: string;
}

export interface SampleInsurerSlaSeed {
  slaType: string;
  targetDays: number;
}

export interface SampleInsurerSeed {
  name: string;
  nameAr: string;
  contactEmail: string;
  contactPhone: string;
  claimsContact: string;
  underwriterContact: string;
  creditTermsDays: number;
  financialStrengthRating: string;
  /**
   * MODULE 0-ب ITEM (e) — THE DATE THE RATING WAS AS AT, required beside it.
   *
   * `Insurer_rating_carries_its_date` refuses either half alone, because the dictionary's correction
   * 5 says «تصنيفاً بلا تاريخٍ دعوى لا سجلّ عناية» — a rating with no date is a claim rather than a
   * due-diligence record.
   *
   * It is on the SEED and not backfilled by a migration, which is the distinction that decided it: a
   * migration inventing a date would be inventing an unsourceable FACT, while giving a SAMPLE row a
   * sample date invents nothing — the rating beside it already says "(sample rating)" in its own
   * value. Without this the constraint shipped `NOT VALID` with three standing exceptions that
   * whoever ran `VALIDATE` in a year would meet with no idea why.
   */
  financialStrengthRatingAsOf: string;
  products: SampleInsurerProductSeed[];
  slaAgreements: SampleInsurerSlaSeed[];
}

export const SAMPLE_INSURERS: SampleInsurerSeed[] = [
  {
    name: "Sample General & Motor Insurance Co.",
    nameAr: "شركة التأمين العام والمركبات (نموذجية)",
    contactEmail: "contact@sample-general-insurance.test",
    contactPhone: "+962-6-500-0001",
    claimsContact: "claims@sample-general-insurance.test",
    underwriterContact: "underwriting@sample-general-insurance.test",
    creditTermsDays: 45,
    financialStrengthRating: "A- (sample rating)",
    financialStrengthRatingAsOf: "2026-01-15",
    products: [
      {
        insuranceLine: "Motor Comprehensive",
        productName: "Motor Comprehensive",
      },
      {
        insuranceLine: "Motor Third Party",
        productName: "Motor Third Party Liability",
      },
      {
        insuranceLine: "Property All Risks",
        productName: "Property All Risks",
      },
      {
        insuranceLine: "General/Product Liability",
        productName: "General Liability",
      },
    ],
    slaAgreements: [
      { slaType: "quote_response", targetDays: 3 },
      { slaType: "policy_issuance", targetDays: 5 },
      { slaType: "claim_handling", targetDays: 15 },
    ],
  },
  {
    name: "Sample Health & Life Assurance Co.",
    nameAr: "شركة التأمين الصحي والحياة (نموذجية)",
    contactEmail: "contact@sample-health-life.test",
    contactPhone: "+962-6-500-0002",
    claimsContact: "claims@sample-health-life.test",
    underwriterContact: "underwriting@sample-health-life.test",
    creditTermsDays: 30,
    financialStrengthRating: "A (sample rating)",
    financialStrengthRatingAsOf: "2026-02-20",
    products: [
      { insuranceLine: "Group Medical", productName: "Group Medical" },
      {
        insuranceLine: "Individual Medical",
        productName: "Individual Medical",
      },
      { insuranceLine: "Group Life", productName: "Group Life" },
      { insuranceLine: "Individual Life", productName: "Individual Life" },
    ],
    slaAgreements: [
      { slaType: "quote_response", targetDays: 5 },
      { slaType: "claim_handling", targetDays: 10 },
    ],
  },
  {
    name: "Sample Composite Insurance Co.",
    nameAr: "الشركة النموذجية للتأمين الشامل",
    contactEmail: "contact@sample-composite-insurance.test",
    contactPhone: "+962-6-500-0003",
    claimsContact: "claims@sample-composite-insurance.test",
    underwriterContact: "underwriting@sample-composite-insurance.test",
    creditTermsDays: 60,
    financialStrengthRating: "A+ (sample rating)",
    financialStrengthRatingAsOf: "2026-03-10",
    products: [
      { insuranceLine: "Motor Fleet", productName: "Motor Fleet" },
      { insuranceLine: "Fire & Property", productName: "Fire & Property" },
      { insuranceLine: "Group Medical", productName: "Group Medical" },
      { insuranceLine: "Group Life", productName: "Group Life" },
      { insuranceLine: "Workers Comp", productName: "Workers Compensation" },
    ],
    slaAgreements: [
      { slaType: "response_time", targetDays: 2 },
      { slaType: "quote_response", targetDays: 4 },
      { slaType: "policy_issuance", targetDays: 7 },
      { slaType: "claim_handling", targetDays: 20 },
    ],
  },
];
