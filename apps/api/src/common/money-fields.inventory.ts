/**
 * The explicit classification of every `Decimal` field in
 * packages/db/prisma/schema.prisma (Part 3.6 Controls; ibms-brain/meta/lex/
 * money-decimal-jod.md — "Applied to every Decimal field in the schema...
 * no exceptions"). `money-fields.inventory.spec.ts` parses the schema and
 * fails if a `Decimal` field exists there that isn't listed in exactly one
 * of the two arrays below — so a newly added field can't silently skip
 * classification, in either direction:
 *
 * - Add a `Decimal(18, 3)` field (a real JOD amount) to `MONEY_DECIMAL_FIELDS`.
 *   Every add/subtract/percentage-application touching it must go through
 *   `money.util.ts` — never a raw `Prisma.Decimal` op, never a `number`.
 * - Add any other-scale `Decimal` field (a rate, score, or ratio — never
 *   itself a stored JOD amount) to `NON_MONEY_DECIMAL_FIELDS` with a comment
 *   saying what scale and why. These still must never touch a JS float when
 *   used in a calculation (e.g. a commission rate multiplied into a
 *   premium), but they don't get quantized to fils by `money.util.ts`
 *   because they aren't money themselves.
 */

/** `Model.field` — every `@db.Decimal(18, 3)` column: a JOD amount at fils precision. */
export const MONEY_DECIMAL_FIELDS: readonly string[] = [
  // Module 0 item (e) — the office's own paid-up capital, compared against art. 4/a's branch-count
  // bands. The first money column that is about the BROKERAGE itself rather than a customer's
  // business, and a real JOD amount either way, so it is quantized to fils like the rest.
  'Organization.paidUpCapital',
  // Module 0-ب item (d). A real JOD amount, so every arithmetic touching it goes through
  // `money.util.ts`. COLLECTED AND NEVER REQUIRED — the bank guarantee has no basis in
  // Instructions No. 9 of 2026, which is recorded on the column itself.
  'Organization.bankGuaranteeAmount',
  'Prospect.expectedPremium',
  'UpSellRecommendation.currentSumInsured',
  'UpSellRecommendation.currentAssetValue',
  'Asset.declaredValue',
  'Asset.annualGrossProfit',
  'InsuranceProgramLine.sumInsuredBasis',
  'Opportunity.targetPremiumThreshold',
  'Quotation.premium',
  'Quotation.deductible',
  'Quotation.liabilityLimit',
  'Policy.requestedPremium',
  'Policy.issuedPremium',
  'Endorsement.premiumAdjustment',
  'Cancellation.returnPremium',
  'Refund.amount',
  'CommissionReversal.amount',
  'Claim.estimatedLoss',
  'Settlement.estimatedLoss',
  'Settlement.approvedAmount',
  'Settlement.deductible',
  'Settlement.netSettlement',
  'ThirdPartyClaimant.recoveryAmount',
  'PremiumTransaction.amount',
  'Invoice.premiumAmount',
  'Invoice.taxAmount',
  'Invoice.feesAmount',
  'Invoice.commissionDeducted',
  'Invoice.totalAmount',
  'Receipt.amount',
  'Remittance.amount',
  'CommissionLedgerEntry.amount',
  'CommissionLedgerEntry.vatAmount',
  'CommissionLedgerEntry.overrideAmount',
  'CommissionLedgerEntry.paidAmount',
  'CommissionLedgerEntry.reversedAmount',
  'ReconciliationException.insurerStatementAmount',
  'ReconciliationException.brokerRecordAmount',
  'ReconciliationException.varianceAmount',
  'ClientFundsLedgerEntry.amount',
  'LossRatio.periodClaims',
  'LossRatio.periodPremium',
  'ProfessionalIndemnityPolicy.coverageLimit',
  'EmployeePerformanceRecord.premiumWritten',
  'EmployeePerformanceRecord.commissionEarned',
  /*
   * MODULE 1's LEGAL-VALUES TABLE (OWNER DECISION 123), and it is the one entry in this list that
   * is money SOMETIMES — so the classification deserves its reason rather than a line.
   *
   * `LegalValue.numericValue` is the single value column for every numeric KIND: `MONEY_JOD`
   * (art. 4/a's three capital amounts, art. 13/b/2's 50,000, art. 15/d/4's 2,000 ceiling) and also
   * `COUNT`, `CALENDAR_DAYS`, `YEARS` and `PERCENT`. One column rather than one per kind, because a
   * reader asking *which column holds this figure* must not have to know the kind first, and a
   * CHECK constraint ties the column to the kind.
   *
   * CLASSIFIED AS MONEY, deliberately and in the safe direction:
   *
   *   * `NON_MONEY_DECIMAL_FIELDS` would FAIL this file's own guard — that list may hold no
   *     `Decimal(18, 3)` field, precisely because (18, 3) IS the money shape, and this column is
   *     (18, 3) so that a JOD figure fits to the fils;
   *   * and a reader who treats every row as money handles the counts correctly too (a count read
   *     through `Decimal` is exact), whereas a reader who treats the money rows as plain numbers
   *     would introduce the float arithmetic `money-decimal-jod.md` exists to forbid.
   *
   * `legal-figures.config.ts` is where the non-money kinds come back out, through
   * `requireWholeNumber`, which REFUSES a fractional count rather than truncating it.
   */
  'LegalValue.numericValue',
];

/**
 * `Model.field` — every `Decimal` column that is NOT itself a stored JOD
 * amount: percentage rates and quality/performance scores
 * (`@db.Decimal(5, 2)`), and the one computed ratio field, `LossRatio.ratio`
 * (`@db.Decimal(7, 4)`, Claims ÷ Premium — a ratio, not an amount).
 */
export const NON_MONEY_DECIMAL_FIELDS: readonly string[] = [
  'UltimateBeneficialOwner.ownershipPercent',
  'Quotation.commissionRatePercent',
  'ComparisonMatrixRow.insurerQualityScore',
  'ComparisonMatrixRow.serviceScore',
  'ConflictOfInterestDisclosure.commissionDifferencePercent',
  'Recommendation.coiCommissionDiffPercent',
  'CommissionAgreement.ratePercent',
  'CommissionAgreement.vatRatePercent',
  'CommissionLedgerEntry.vatRatePercent',
  'InsurerPerformanceScore.quoteResponseScore',
  'InsurerPerformanceScore.claimsServiceScore',
  'InsurerPerformanceScore.priceScore',
  'InsurerPerformanceScore.serviceQualityScore',
  'EmployeePerformanceRecord.renewalRatePercent',
  'EmployeePerformanceRecord.crossSellRatePercent',
  'LossRatio.ratio',
];
