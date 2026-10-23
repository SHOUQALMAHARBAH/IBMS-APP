import type { TranslationKey } from '../i18n/translations';

/**
 * THE EIGHTEEN THINGS THAT CARRY A WORKFLOW STATE — owner decision 41.
 *
 * `/audit-trail`'s workflow-history section used to ask for the entity type as FREE TEXT, validated
 * server-side against `@Length(1, 100)` and against nothing else. So a person had to guess the exact
 * string the writers store — `CrossSellOpportunity`, not "cross-sell" — and then paste a uuid beside
 * it. Both fields were `required`, which is why that section could not be used at all by anybody who
 * did not already know both answers. The vocabulary IS closed, so the type half becomes a `<select>`
 * with no new route and no new permission.
 *
 * ## Why this list is declared here and not imported
 *
 * `WorkflowEntityType` lives in `apps/api/src/modules/workflow/workflow-transitions.config.ts`. The web
 * has no import path to an api module — two packages, two builds — so this is a hand-written copy, in
 * the api's own declaration order rather than alphabetically, exactly as `AuditAction` is copied in
 * `audit-trail-api.ts`.
 *
 * **A copy with nothing checking it is the defect, not the copy.**
 * `packages/db/prisma/workflow-entity-type-parity.spec.ts` reads both files as text and fails in both
 * directions, because `packages/db` is the only place that can see both. The direction that matters is
 * a member ADDED IN THE API and missing here: the select would silently stop offering a type whose
 * history somebody needs, and nothing would fail. The mirror is rot — an option that returns nothing.
 *
 * ## What the compiler covers, and what it cannot
 *
 * `WORKFLOW_ENTITY_LABEL` is a total `satisfies Record<WorkflowEntityType, …>`, so adding a member to
 * THIS union without deciding its label is a type error. That is real and it is not the guard above: it
 * fires only once somebody has already copied the member across, and the copy itself is what no type
 * can see.
 */
export type WorkflowEntityType =
  | 'Opportunity'
  | 'RFQInsurer'
  | 'Policy'
  | 'Endorsement'
  | 'Claim'
  | 'Complaint'
  | 'RenewalCase'
  | 'Invoice'
  | 'DataSubjectRequest'
  | 'IncidentReport'
  | 'DisposalBatch'
  | 'Lead'
  | 'KYCRecord'
  | 'Customer'
  | 'NeedsAssessment'
  | 'InsuranceProgram'
  | 'CrossSellOpportunity'
  | 'UpSellRecommendation';

/**
 * THE WORD FOR EACH TYPE. ALL EIGHTEEN HAVE ONE; `null` WOULD MEAN "NOBODY HAS WRITTEN ONE".
 *
 * ## Every label is DERIVED, never invented
 *
 * The owner's instruction: take the Arabic from a string ALREADY RENDERING in the product, and invent
 * nothing. Fifteen come from the heading of that entity's own screen under `app/(app)/`; three come
 * from elsewhere, because their entity has no screen or its heading names something else. There was no Arabic for this vocabulary anywhere in the i18n tree —
 * checked `enums.ts` and `compliance-risk.ts` — and writing eighteen Arabic words would have been
 * eighteen inventions in a legal-compliance screen. So each value below is the translation KEY of a
 * heading that already renders on the screen where that entity lives, which means the word a reader
 * sees in this dropdown is the same word they see at the top of the screen they came from.
 *
 * Deriving rather than hand-writing is also the cure for a measured hazard: a column hand-written
 * earlier in this module had four of six spot-checked rows wrong.
 *
 * ## ALL EIGHTEEN HAVE A WORD. THE THREE THAT DID NOT, AND WHAT DISSOLVED THEM
 *
 * This map carried three `null`s for one day — `Opportunity`, `Endorsement`, `Invoice` — and the note
 * here said those three words were the owner's to write. **THAT WAS WRONG, AND THE SCOPE OF THE SEARCH
 * IS WHY**: derivation had been limited to screen `<h1>`s, and all three plurals were already rendering
 * elsewhere in the product the whole time. They were filled on 2026-10-23 from those strings, so the
 * owner wrote nothing and `null` is now reachable by no member.
 *
 *   * `Opportunity` → «الفرص» / "Opportunities", the FIRST HALF of `navOpportunitiesMarket`
 *     («الفرص / السوق»); the `/ السوق` belongs to the combined screen. **That nav label is the un-stale
 *     twin of this screen's own `<h1>`**, which reads «طلب عروض الأسعار / السوق» / "RFQ / market" and
 *     names the RFQ rather than the Opportunity — the nav entry was corrected for exactly that reason
 *     on 2026-10-19 and the `<h1>` was not. Deriving from the `<h1>` would have put a label meaning
 *     "RFQ" beside `RFQInsurer`'s own «مشاركات شركات التأمين».
 *   * `Endorsement` → «الملحقات» from `policyRequestedExtensionsLabel`, and "Endorsements" from
 *     `endorsementSectionHeading` — TWO SOURCES, because that extensions key's English says
 *     *extensions* rather than endorsements. There is still no `/endorsements` screen; an endorsement
 *     is reached through a policy.
 *   * `Invoice` → «الفواتير» / "Invoices" from `caColInvoices`. There is still no `/invoices` screen.
 *
 * **THE THREE ARE THEIR OWN KEYS, NOT POINTERS AT THOSE SOURCES.** A pointer would make an entity's
 * label hostage to a table column's wording or to a nav entry's second noun. And the values were
 * SLICED OUT by script rather than retyped: the recorded failure mode for Arabic here is shadda/vowel
 * ORDER, which renders identically and compares unequal, and an extraction cannot make that mistake.
 *
 * **IF A NINETEENTH MEMBER ARRIVES WITH NO WORD**, `null` is still the honest value — it renders the
 * MEMBER NAME verbatim, which is deliberately visible, because an English member name in an Arabic
 * dropdown is obviously unfinished where a plausible invented word is indistinguishable from a decided
 * one and would never be corrected. Declare it in `MAY_HAVE_NO_LABEL` in the parity spec, which is
 * EMPTY now and is what makes a null a flat ban.
 *
 * ## A VOCABULARY DIVERGENCE, FOUND HERE AND RESOLVED ELSEWHERE — OWNER DECISION 42
 *
 * For one day this product used TWO Arabic words for an endorsement: the policy screen's own
 * `endorsementSectionHeading` said «التعديلات» while the document-category vocabulary says
 * «ملحق»/«الملحقات», which is the family this map took. So a reader who picked «الملحقات» here
 * and then opened a policy saw a different word over the same records.
 *
 * **DECIDED 2026-10-23: the product keeps «الملحقات» and the policy screen was corrected to it.** The
 * owner's grounds are worth keeping, because they are the test for the next word like this: «ملحق»
 * is her own word in the ز.١ list of licence-gated acts, and «تعديل» is a GENERAL word that would
 * fit any change anywhere in the system. So this map's label did not move; the divergence closed
 * from the other end, and nothing here depends on that having happened.
 *
 * ## Two labels that are broader than their member, recorded rather than silently accepted
 *
 * `DisposalBatch` takes «الاحتفاظ والإتلاف» ("Retention & Disposal"), its screen's MODULE heading, and
 * `KYCRecord` takes «قائمة فحص اعرف عميلك» ("KYC compliance queue"), which names a queue rather than a
 * record. Both are the real heading of the real screen, both are recognisable, and narrowing either
 * would mean writing a word — which is the one thing this map does not do.
 */
export const WORKFLOW_ENTITY_LABEL = {
  // Its own screen's `<h1>` names the RFQ, not this — so the word comes from the corrected NAV
  // label instead, first half only. See the note above.
  Opportunity: 'workflowEntityOpportunity',
  // `/rfqs/[id]` — the submissions table IS the `RFQInsurer` rows.
  RFQInsurer: 'rfqSubmissionsHeading',
  Policy: 'policiesListHeading',
  // No `/endorsements` screen; «الملحقات» and "Endorsements" come from two different keys.
  Endorsement: 'workflowEntityEndorsement',
  Claim: 'claimsQueueHeading',
  Complaint: 'complaintsHeading',
  RenewalCase: 'renRenewalCases',
  // No `/invoices` screen; from `caColInvoices`.
  Invoice: 'workflowEntityInvoice',
  DataSubjectRequest: 'dsrHeading',
  IncidentReport: 'incHeading',
  DisposalBatch: 'rdHeading',
  Lead: 'leadsHeading',
  KYCRecord: 'kycQueuePageHeading',
  Customer: 'customersHeading',
  NeedsAssessment: 'naHeading',
  InsuranceProgram: 'iprogHeading',
  CrossSellOpportunity: 'xsHeading',
  UpSellRecommendation: 'upsHeading',
} satisfies Record<WorkflowEntityType, TranslationKey | null>;

/**
 * The select's options, in the api's declaration order.
 *
 * Derived from the label map's keys rather than written a second time — a second list is a second
 * answer to "which eighteen", and `Object.keys` of a total map cannot disagree with the union.
 */
export const WORKFLOW_ENTITY_TYPES = Object.keys(
  WORKFLOW_ENTITY_LABEL,
) as WorkflowEntityType[];
