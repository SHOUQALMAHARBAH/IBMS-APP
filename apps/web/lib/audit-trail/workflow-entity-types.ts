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
 * THE WORD FOR EACH TYPE, OR `null` MEANING "NOBODY HAS WRITTEN ONE".
 *
 * ## Every label is DERIVED, never invented
 *
 * The owner's instruction: take the Arabic from the EXISTING heading of that entity's own screen under
 * `app/(app)/`, and invent nothing. There was no Arabic for this vocabulary anywhere in the i18n tree —
 * checked `enums.ts` and `compliance-risk.ts` — and writing eighteen Arabic words would have been
 * eighteen inventions in a legal-compliance screen. So each value below is the translation KEY of a
 * heading that already renders on the screen where that entity lives, which means the word a reader
 * sees in this dropdown is the same word they see at the top of the screen they came from.
 *
 * Deriving rather than hand-writing is also the cure for a measured hazard: a column hand-written
 * earlier in this module had four of six spot-checked rows wrong.
 *
 * ## THE THREE `null`s, AND WHY A `null` IS HONEST HERE
 *
 * A `null` renders the MEMBER NAME verbatim — `Endorsement` — rather than a guessed Arabic word. That
 * is deliberately visible: an English member name in an Arabic dropdown is obviously unfinished, where
 * a plausible invented word is indistinguishable from a decided one and would never be corrected.
 *
 *   1. `Endorsement` — there is NO screen for endorsements under `app/(app)/`, so there is no heading
 *      to derive from. (`Endorsement` rows are reached through a policy today.)
 *   2. `Invoice` — the same: no `/invoices` screen exists.
 *   3. `Opportunity` — a screen exists (`/opportunities`) and its heading is UNUSABLE for this purpose:
 *      `oppListHeading` reads «طلب عروض الأسعار / السوق» / "RFQ / market", which names the RFQ and not
 *      the Opportunity. The NAV label for that screen was already corrected for exactly this reason
 *      (CLAUDE.md, 2026-10-19: *the old label stopped lying*) and the `<h1>` was not. Deriving from it
 *      would put a label meaning "RFQ" next to `RFQInsurer`'s own «مشاركات شركات التأمين», giving two
 *      confusable options of which one is wrong — so it is reported instead.
 *
 * Those three words are the OWNER'S to write, on her walk. Do not fill them in from this file.
 *
 * ## Two labels that are broader than their member, recorded rather than silently accepted
 *
 * `DisposalBatch` takes «الاحتفاظ والإتلاف» ("Retention & Disposal"), its screen's MODULE heading, and
 * `KYCRecord` takes «قائمة فحص اعرف عميلك» ("KYC compliance queue"), which names a queue rather than a
 * record. Both are the real heading of the real screen, both are recognisable, and narrowing either
 * would mean writing a word — which is the one thing this map does not do.
 */
export const WORKFLOW_ENTITY_LABEL = {
  // No usable heading — see `null` note 3. Its screen's own `<h1>` names the RFQ, not this.
  Opportunity: 'workflowEntityOpportunity',
  // `/rfqs/[id]` — the submissions table IS the `RFQInsurer` rows.
  RFQInsurer: 'rfqSubmissionsHeading',
  Policy: 'policiesListHeading',
  // No screen — see `null` note 1.
  Endorsement: 'workflowEntityEndorsement',
  Claim: 'claimsQueueHeading',
  Complaint: 'complaintsHeading',
  RenewalCase: 'renRenewalCases',
  // No screen — see `null` note 2.
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
