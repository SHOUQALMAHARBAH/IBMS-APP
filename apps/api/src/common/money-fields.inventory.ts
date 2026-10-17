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
