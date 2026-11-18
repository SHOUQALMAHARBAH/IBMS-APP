// Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). Talks
// to apps/api's rfq module (rfq.controller.ts + rfq-insurer.controller.ts).
// One RFQ per insurance line under an Opportunity, sent to a shortlist of
// insurers; each shortlisted insurer is tracked as an RFQInsurer submission.

import { apiGet, apiPost } from '../auth/api-client';

export type RfqInsurerStatus =
  | 'SENT'
  | 'VIEWED'
  | 'QUOTED'
  | 'DECLINED'
  | 'NO_RESPONSE';

/** The response statuses a caller may move a submission *to* (SENT is the
 * initial state, never a target). Keep in sync with
 * `RFQ_INSURER_TARGET_STATUSES` in
 * apps/api/src/modules/rfq/dto/transition-rfq-insurer.dto.ts. */
export const RFQ_INSURER_TARGET_STATUSES: readonly RfqInsurerStatus[] = [
  'VIEWED',
  'QUOTED',
  'DECLINED',
  'NO_RESPONSE',
];

export interface SelectableInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
}

export interface RfqInsurerSubmission {
  id: string;
  rfqId: string;
  insurerId: string;
  status: RfqInsurerStatus;
  sentAt: string;
  respondedAt: string | null;
  followUpAlertSentAt: string | null;
  insurer: SelectableInsurer;
}

export interface Rfq {
  id: string;
  opportunityId: string;
  insuranceLine: string;
  /** §P4 — the line's Arabic name, sent by the server. null when none is known. */
  insuranceLineAr: string | null;
  issuedAt: string;
  followUpThresholdDays: number;
  issuedByUserId: string | null;
  insurerSubmissions: RfqInsurerSubmission[];
  /** Resolved off the parent Opportunity — Part D §5.1 touchpoint #4
   * (RFQ/market placement) needs it for the RFQ detail page's
   * consent-capture control. */
  opportunity: { customerId: string };
  /**
   * ART. 15/d — what this request rests on, when it reached fewer than three insurers.
   *
   * NULL for the overwhelming majority: 84.3% of requests reach three or more and rest on
   * nothing, because that is the law being complied with (OWNER DECISION 130 ruling 1). Present
   * only on `GET /rfqs/:id`, not on the list — a register of exemptions is a different screen
   * from a list of requests.
   */
  article15DExemption?: Article15DExemptionRecord | null;
  /** Art. 15/d/4's warnings: a quotation came back above the ceiling the request was sent
   *  under. OWNER DECISION 126 — it warns, and the quotation stands. */
  article15DAlerts?: Article15DAlert[];
}

export interface Article15DExemptionRecord {
  id: string;
  exemption: Article15DExemption;
  /** «وسمه النظام» or «اختاره فلان» — decision 129's criterion 7. Every row written today is
   *  `CHOSEN_BY_PERSON`: measured, the system can tag none of the five. */
  basis: 'TAGGED_BY_SYSTEM' | 'CHOSEN_BY_PERSON';
  /** How many insurers the request had reached. Decision 130 ruling 2 counts PER REQUEST. */
  insurerCount: number;
  /** Exemption 4 only, as strings — `money-decimal-jod.md`. */
  declaredAnnualPremiumJod: string | null;
  ceilingValueJod: string | null;
  evidenceCommunicationLogId: string | null;
  /**
   * 🔴 OWNER DECISION 139 ruling 2 — «بلا إثبات»: this exemption rests on a customer's
   * request that is not on file yet.
   *
   * DERIVED BY THE API and sent, never worked out here. The two facts it rests on are both
   * in this payload, so a local derivation would compile — and would be a second home for
   * the rule. Optional because ~every spec that builds this record predates it, and absent
   * reads as NOT marked, which is the quiet direction rather than the alarming one.
   */
  lacksEvidence?: boolean;
  /** The name AS IT STOOD. OWNER DECISION 48: a record that can only name a uuid is a record
   *  nobody can read. */
  chosenByNameShown: string | null;
  recordedAt: string;
}

/**
 * 🔴 OWNER DECISION 143 — ONE CANDIDATE THE «إرفاق المراسلة» BUTTON MAY OFFER.
 *
 * Named rather than written inline twice, because the creation window and the attach picker are
 * given the SAME shape by the SAME server query, and two structural literals that happen to
 * match are two homes for that agreement. `channel` is a string rather than the api's
 * `InteractionChannel` for the reason every other type here is: the web cannot import the api's
 * enums, and the screen looks the label up through a partial map with a fallback.
 *
 * ⛔ NO `subject` AND NO `body`, and that is the server's rule rather than this file's: a
 * communication's text is Confidential, and the employee identifies the message by when it came
 * and how it came.
 */
export interface Article15DEvidenceOption {
  id: string;
  channel: string;
  sentAt: string;
}

export interface Article15DAlert {
  id: string;
  quotedPremiumJod: string;
  ceilingValueJod: string;
  raisedAt: string;
}

/** Process 12 — a broker<->insurer exchange on an RFQ: an insurer's query
 * (`INBOUND`) or the broker's answer / additional-information note
 * (`OUTBOUND`). */
export type CommunicationDirection = 'INBOUND' | 'OUTBOUND';

export interface RfqCommunication {
  id: string;
  rfqId: string;
  rfqInsurerId: string | null;
  direction: CommunicationDirection;
  channel: string;
  subject: string | null;
  body: string | null;
  loggedByUserId: string | null;
  sentAt: string;
  createdAt: string;
  rfqInsurer: {
    id: string;
    insurer: { id: string; name: string; nameAr: string | null };
  } | null;
}

export interface LogRfqCommunicationInput {
  direction: CommunicationDirection;
  channel: string;
  body: string;
  subject?: string;
  rfqInsurerId?: string;
  occurredAt?: string;
}

export interface CreateRfqInput {
  opportunityId: string;
  insuranceLine: string;
  insurerIds: string[];
  followUpThresholdDays?: number;
  /** ART. 15/d — only when this request goes to fewer than three insurance companies. Absent on
   *  84.3% of requests, which is what OWNER DECISION 130 ruling 1 expects. */
  article15D?: Article15DChoice;
}

/** One of art. 15/d's five exemptions, as the api names them. */
export type Article15DExemption =
  | 'INDIVIDUAL_MEDICAL_RENEWAL'
  | 'GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS'
  | 'DEFINED_BENEFIT_CONTRACT'
  | 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT'
  | 'AT_CUSTOMER_REQUEST';

export interface Article15DChoice {
  exemption?: Article15DExemption;
  /** Exemption 4 only. A STRING, never a number: `money-decimal-jod.md`, and the difference
   *  between 2000 and 2000.001 is the difference between qualifying and not. */
  declaredAnnualPremiumJod?: string;
  /** Exemption 5 only. */
  evidenceCommunicationLogId?: string;
  /** Only when NO exemption applies. */
  declaration?: { reason: string; acknowledged: boolean };
}

/**
 * ART. 15/d's QUESTION, answered by the server for a request that does not exist yet.
 *
 * ⛔ THE SCREEN DECIDES NONE OF THIS. The minimum and the ceiling are `LegalValue` rows read at
 * the request's own date, which exemptions can apply is a property of the standard line
 * catalogue, and whether the employee may DECLARE is a permission. A screen that decided any of
 * them would be a second answer to a legal question.
 */
export interface Article15DOptions {
  required: boolean;
  minInsurers: number;
  /** The ceiling in force, as a string. Rendered INTO the fourth exemption's own label. */
  premiumCeilingJod: string;
  exemptions: { exemption: Article15DExemption; because: string }[];
  mayDeclare: boolean;
  /** Exemption 5's candidates: this customer's inbound messages on an approved means. Carries
   *  no subject and no body — a communication's text is Confidential and this list is read by
   *  whoever may create a quote request, not by whoever may read correspondence. */
  evidence: Article15DEvidenceOption[];
  /**
   * 🔴 THE ADVISER'S OWN WINDOW, FROM THE SERVER AND NEVER FROM A DICTIONARY.
   *
   * The record stores what the employee was SHOWN (element 1), and that is true by construction
   * only while the screen renders the same constant the server stores. So these four strings
   * are not translated and are not ours: they are his, re-sliced from his own file byte for byte
   * by `declared-act.config.spec.ts`. An English rendering of a regulatory acknowledgement would
   * be a sentence he never drafted and the record never stored.
   */
  window: {
    title: string;
    text: string;
    reasonHint: string;
    acknowledgement: string;
    reasonMinLength: number;
  };
}

/**
 * 🔴 OWNER DECISION 143 — what «إرفاق المراسلة» may offer on a request that already exists.
 *
 * `rfq.communication.log` on the server, the SAME code as the attach it feeds — so a caller who
 * is shown the button is a caller the list will answer, and the screen never offers a choice the
 * server is about to refuse.
 */
export function listArticle15DEvidenceOptions(
  rfqId: string,
): Promise<Article15DEvidenceOption[]> {
  return apiGet(`/rfqs/${rfqId}/article-15-d/evidence-options`);
}

/**
 * 🔴 OWNER DECISION 139 ruling 4, reached by OWNER DECISION 143's button — the mark goes.
 *
 * ⛔ There is no sibling that removes it. The row is append-only with exactly one permitted
 * transition (evidence NULL ⟶ NOT NULL), so «no permission removes the mark» is the database's
 * answer rather than this client's politeness.
 */
export function attachArticle15DEvidence(
  rfqId: string,
  evidenceCommunicationLogId: string,
): Promise<{ attached: true }> {
  return apiPost(`/rfqs/${rfqId}/article-15-d/evidence`, {
    evidenceCommunicationLogId,
  });
}

export function getArticle15DOptions(query: {
  opportunityId: string;
  insuranceLine: string;
  insurerCount: number;
}): Promise<Article15DOptions> {
  const params = new URLSearchParams({
    opportunityId: query.opportunityId,
    insuranceLine: query.insuranceLine,
    insurerCount: String(query.insurerCount),
  });
  return apiGet(`/rfqs/article-15-d/options?${params.toString()}`);
}

export function createRfq(input: CreateRfqInput): Promise<Rfq> {
  return apiPost('/rfqs', input);
}

export function listSelectableInsurers(): Promise<SelectableInsurer[]> {
  return apiGet('/rfqs/selectable-insurers');
}

/** One line this opportunity can still be taken to market on — §P3. */
export interface AvailableLine {
  insuranceLine: string;
  insuranceLineAr: string | null;
}

/**
 * The lines of this opportunity's programme that have no RFQ yet.
 *
 * ⛔ THE SCREEN DOES NOT FILTER THIS. Which lines are offerable is decided by the server — on
 * the programme, and on the `@@unique([opportunityId, insuranceLine])` the second RFQ would hit
 * — and a second filter here would disagree with it the first time either rule moved. Gated on
 * `rfq.create`, the same code as the request this feeds.
 */
export function listAvailableLines(
  opportunityId: string,
): Promise<AvailableLine[]> {
  return apiGet(
    `/rfqs/available-lines?opportunityId=${encodeURIComponent(opportunityId)}`,
  );
}

export function listRfqs(
  scope: { opportunityId: string } | { customerId: string },
): Promise<Rfq[]> {
  const query =
    'opportunityId' in scope
      ? `opportunityId=${encodeURIComponent(scope.opportunityId)}`
      : `customerId=${encodeURIComponent(scope.customerId)}`;
  return apiGet(`/rfqs?${query}`);
}

export function getRfq(id: string): Promise<Rfq> {
  return apiGet(`/rfqs/${id}`);
}

export function addRfqInsurers(
  rfqId: string,
  insurerIds: string[],
): Promise<Rfq> {
  return apiPost(`/rfqs/${rfqId}/insurers`, { insurerIds });
}

export function transitionRfqInsurer(
  submissionId: string,
  toStatus: RfqInsurerStatus,
): Promise<RfqInsurerSubmission> {
  return apiPost(`/rfq-insurers/${submissionId}/transition`, { toStatus });
}

export function listRfqCommunications(
  rfqId: string,
): Promise<RfqCommunication[]> {
  return apiGet(`/rfqs/${rfqId}/communications`);
}

export function logRfqCommunication(
  rfqId: string,
  input: LogRfqCommunicationInput,
): Promise<RfqCommunication> {
  return apiPost(`/rfqs/${rfqId}/communications`, input);
}
