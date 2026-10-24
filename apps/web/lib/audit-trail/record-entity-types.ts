import type { TranslationKey } from '../i18n/translations';

/**
 * OWNER DECISION 53 — THE WORD FOR A RECORD TYPE ON `/internal-controls` AND `/sla-dashboard`,
 * DERIVED FROM WHAT THE PRODUCT ALREADY SAYS.
 *
 * Decision 49's test is *a name where the set is CLOSED, the type and number where it is OPEN*,
 * and both these sets ARE closed — the maker/checker registry by `check:maker-checker-pairs`,
 * the SLA registry by its own inventory spec — so the ruling says name them. Batch eight reported
 * that nine words were missing on each screen and STOPPED, which was the right call on what it
 * had measured and the wrong conclusion: **it measured against decision 41's eighteen labels
 * alone and never looked outside that map.** Every single member turned out to have a source
 * already shipping in the product. The correction is recorded here rather than only in a report,
 * because the mistake was a procedure not applied, not a fact got wrong.
 *
 * NOT ONE ARABIC WORD IS TYPED OR EVEN NEW. Fifteen of the sixteen entries POINT AT THE KEY
 * ALREADY RENDERING ON THAT ENTITY'S OWN SCREEN — which is exactly decision 41's mechanism and
 * its stated reason: *the word in the dropdown is the word at the top of the screen the reader
 * came from*. The sixteenth is the one slice, below.
 *
 * TWO MAPS, NOT ONE, and that is deliberate. The two screens answer about different closed sets
 * (fifteen maker/checker pairs; sixteen SLA-tracked workflows) which overlap without either
 * containing the other, so a single merged map would be TOTAL over neither and a member could go
 * missing from the set that needed it while the map still looked complete.
 * `record-entity-types.spec.ts` asserts each map is total over its OWN source of truth, read from
 * the api rather than restated here.
 *
 * SEVERAL WORDS ARE BROADER THAN THEIR MEMBER AND THAT IS SHIPPED AND RECORDED, never narrowed —
 * narrowing means writing, which is decision 94's reservation. The precedent is decision 41's
 * own: `DisposalBatch` renders «الاحتفاظ والإتلاف», the whole retention-and-disposal module, and
 * `KYCRecord` renders its queue's heading. Each broader row carries a note saying so.
 */

/** The one derived key. Every other entry is a pointer. */
export const RECORD_ENTITY_DERIVED_KEYS = {
  /**
   * `PolicyChecking` has no screen of its own, and the only string in the product naming it is
   * the operational-risk source label «اختلاف في تدقيق الوثيقة» / 'Policy Checking discrepancy'.
   * Pointing at that whole value would label a policy-checking record a DISCREPANCY, which is a
   * false statement about a record that may have none — so the word is SLICED out of it.
   *
   * The Arabic is a byte-identical substring of `opSourcePolicyCheckingDiscrepancy`'s own value
   * with its first two words dropped, verified as a substring and as NFC by the derivation. The
   * English is sliced from the OTHER end, because the two languages order the words differently:
   * mirroring the Arabic slice produced 'Checking discrepancy' on the first run, a wrong label
   * caught by reading the output rather than by the script failing.
   */
  recordEntityPolicyChecking: 'recordEntityPolicyChecking',
} as const;

/**
 * The fifteen maker/checker entity types, each to the key already naming it.
 *
 * Source of truth: `apps/api/src/common/maker-checker-pairs.config.ts`. A sixteenth pair cannot
 * ship unworded — the spec beside this file fails by name.
 */
export const MAKER_CHECKER_ENTITY_LABEL = {
  // --- the six decision 41 already worded, pointed at the SAME keys it uses, so the two maps
  //     cannot drift into two words for one entity.
  Complaint: 'complaintsHeading',
  DataSubjectRequest: 'dsrHeading',
  /** BROADER — the whole retention-and-disposal module. Decision 41's own choice, kept. */
  DisposalBatch: 'rdHeading',
  IncidentReport: 'incHeading',
  /** BROADER — the KYC QUEUE's heading, not one record. Decision 41's own choice, kept. */
  KYCRecord: 'kycQueuePageHeading',
  NeedsAssessment: 'naHeading',

  // --- the nine batch eight reported as wordless. Every one had a source.
  /** BROADER — the recertification MODULE. The item and the cycle share this word and never
   * share a screen: the ITEM is a maker/checker pair, the CYCLE is an SLA-tracked workflow. */
  AccessRecertificationItem: 'acrHeading',
  /** BROADER — commission as a concept, not one ledger entry. */
  CommissionLedgerEntry: 'commissionSectionHeading',
  DataProcessingAgreement: 'vendDpaHeading',
  /** BROADER — third parties AND data sharing, not one approval. */
  DataSharingApproval: 'dsaHeading',
  PolicyChecking: 'recordEntityPolicyChecking',
  Recommendation: 'recSectionHeading',
  Refund: 'endorsementRefundLabel',
  /** BROADER — the retention SCHEDULE, not one row of it. */
  RetentionScheduleItem: 'rdScheduleHeading',
  Settlement: 'claimSettlementHeading',
} as const satisfies Record<string, TranslationKey>;

/**
 * The sixteen SLA-tracked entity types, each to the key already naming it.
 *
 * Source of truth: `apps/api/src/modules/sla/sla-registry.config.ts`.
 */
export const SLA_ENTITY_LABEL = {
  // --- the seven decision 41 already worded.
  Claim: 'claimsQueueHeading',
  Complaint: 'complaintsHeading',
  DataSubjectRequest: 'dsrHeading',
  /** BROADER — see the maker/checker map. */
  DisposalBatch: 'rdHeading',
  IncidentReport: 'incHeading',
  /** BROADER — see the maker/checker map. */
  KYCRecord: 'kycQueuePageHeading',
  RenewalCase: 'renRenewalCases',

  // --- the nine batch eight reported as wordless.
  AccessDeprovisioningChecklist: 'empdDeprovisioningHeading',
  /** BROADER — the recertification MODULE, as the item is. */
  AccessRecertificationCycle: 'acrHeading',
  /** BROADER — consent MANAGEMENT, not one record. */
  ConsentRecord: 'consHeading',
  /** BROADER — third parties AND data sharing, not one approval. */
  DataSharingApproval: 'dsaHeading',
  DpiaScreening: 'dpiaHeading',
  LegalHold: 'rdHoldsHeading',
  /** BROADER — the match REVIEW queue's own heading, not one match. */
  ScreeningMatch: 'smSanctionsMatchReview',
  /** BROADER — customer requests as a queue. */
  ServiceRequest: 'srHeading',
  Vendor: 'venHeading',
} as const satisfies Record<string, TranslationKey>;

/**
 * Whether a stored type has a word, as a TYPE PREDICATE rather than a boolean.
 *
 * A predicate is what makes `LABEL[type]` unreachable without the guard: a plain boolean would
 * need a cast at the call site, and a cast is where a guard becomes optional. Batch eight proved
 * this is load-bearing rather than stylistic — planting `true ?` at the `/audit-trail` call site
 * guarded by its own predicate was a BUILD error (`TS7053`), not a test failure, because the
 * compiler refuses to index the map with a bare `string`.
 *
 * `hasOwnProperty` rather than `in`, so a member named `toString` cannot read as worded.
 */
export function makerCheckerEntityLabel(
  type: string,
): TranslationKey | null {
  return Object.prototype.hasOwnProperty.call(MAKER_CHECKER_ENTITY_LABEL, type)
    ? MAKER_CHECKER_ENTITY_LABEL[type as keyof typeof MAKER_CHECKER_ENTITY_LABEL]
    : null;
}

export function slaEntityLabel(type: string): TranslationKey | null {
  return Object.prototype.hasOwnProperty.call(SLA_ENTITY_LABEL, type)
    ? SLA_ENTITY_LABEL[type as keyof typeof SLA_ENTITY_LABEL]
    : null;
}
