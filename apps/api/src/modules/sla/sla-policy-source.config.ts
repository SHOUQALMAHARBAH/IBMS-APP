import type { SlaSourceType } from '@ibms/db';

/**
 * WHERE EACH SLA ACTUALLY COMES FROM — the provenance half of every registry
 * entry, stated per workflow rather than inferred.
 *
 * ## Why this is a hand-written table and not a parser
 *
 * `SlaRegistryEntry.citation` is free text. The obvious shortcut — "REGULATORY
 * if the citation mentions PRIV-STD or PRIV-SOP" — produces a WRONG answer on
 * this very data set: `vendor_termination_access_revocation`'s citation reads
 * "no independent PRIV-SOP figure identified beyond the backlog", and a
 * substring match reads that NEGATION as a citation and stamps the SLA
 * regulatory. Claiming legal force for a figure whose own note says nobody
 * found a legal source for it is precisely the failure this whole feature
 * exists to prevent, so the classification is explicit and reviewable.
 *
 * ## The rule applied
 *
 * `REGULATORY` only where the citation names a specific governing document
 * section as the source of THE FIGURE — a `PRIV-STD-*` section, a `PRIV-SOP-*`
 * procedure, or the Governing Policy. Everything else is classified by what it
 * actually is. Where there was doubt the entry is deliberately classified
 * DOWN, never up: under-claiming legal force is recoverable, over-claiming it
 * is the thing a regulator would take issue with.
 *
 * The durations, escalation stages and entity types still come from
 * `SLA_REGISTRY` — this table adds only provenance, so there remains exactly
 * one place a duration is written.
 */
export interface SlaPolicySource {
  sourceType: SlaSourceType;
  /** The specific rule/row relied on. Mandatory for REGULATORY (DB CHECK). */
  sourceReference: string | null;
  /** The governing document. Mandatory for REGULATORY (DB CHECK). */
  sourceDocument: string | null;
  sourceSection: string | null;
  /** Why this classification, in the reviewer's own terms. Seeded into
   * `SlaPolicy.description` so the reasoning travels with the row. */
  rationale: string;
}

const PDPL_REGISTRY = 'ibms-brain/meta/lex/pdpl-sla-timers.md';

export const SLA_POLICY_SOURCES: Readonly<Record<string, SlaPolicySource>> = {
  // --- REGULATORY: the figure is traceable to a governing document section --
  consent_withdrawal: {
    sourceType: 'REGULATORY',
    sourceReference: 'Consent withdrawal (M03)',
    sourceDocument: 'PRIV-STD-01',
    sourceSection: '§6.3 (also PRIV-SOP-04)',
    rationale: `PDPL consent-withdrawal deadline; figure carried by ${PDPL_REGISTRY} and sourced to PRIV-STD-01 §6.3.`,
  },
  dsr_access_deletion: {
    sourceType: 'REGULATORY',
    sourceReference: 'DSR — Access / Deletion (M04)',
    sourceDocument: 'PRIV-STD-01',
    sourceSection: '§6.4 (also PRIV-SOP-05)',
    rationale:
      'Statutory data-subject-request turnaround. PRIV-STD-01 §6.4 is the source of the figure.',
  },
  dsr_correction_objection: {
    sourceType: 'REGULATORY',
    sourceReference: 'DSR — Correction / Objection (M04)',
    sourceDocument: 'PRIV-STD-01',
    sourceSection: '§6.4 (also PRIV-SOP-05)',
    rationale:
      'Statutory data-subject-request turnaround. PRIV-STD-01 §6.4 is the source of the figure.',
  },
  termination_access_revocation: {
    sourceType: 'REGULATORY',
    sourceReference: 'Termination access revocation (M05)',
    sourceDocument: 'PRIV-STD-02',
    sourceSection: 'PRIV-SOP-01/02/03',
    rationale:
      'Access-control obligation on termination; figure sourced to PRIV-STD-02.',
  },
  quarterly_access_review: {
    sourceType: 'REGULATORY',
    sourceReference: 'Quarterly access review (M05)',
    sourceDocument: 'PRIV-STD-02',
    sourceSection: 'PRIV-SOP-01/02/03',
    rationale:
      'Periodic access-recertification cadence; figure sourced to PRIV-STD-02.',
  },
  disposal_batch_execution: {
    sourceType: 'REGULATORY',
    sourceReference: 'Disposal batch execution (M06)',
    sourceDocument: 'PRIV-STD-03',
    sourceSection: 'PRIV-SOP-07/08',
    rationale:
      'Retention/disposal execution deadline; figure sourced to PRIV-STD-03.',
  },
  legal_hold_necessity_review: {
    sourceType: 'REGULATORY',
    sourceReference: 'Legal Hold necessity review (M06)',
    sourceDocument: 'PRIV-STD-03',
    sourceSection: 'PRIV-SOP-07/08',
    rationale: 'Legal-hold review cadence; figure sourced to PRIV-STD-03.',
  },
  vendor_annual_review: {
    sourceType: 'REGULATORY',
    sourceReference: 'Vendor annual review (M07)',
    sourceDocument: 'PRIV-STD-04',
    sourceSection: 'PRIV-SOP-10',
    rationale:
      'Third-party/processor review cadence; figure sourced to PRIV-STD-04.',
  },
  data_sharing_decision: {
    sourceType: 'REGULATORY',
    sourceReference: 'Data sharing decision (M08)',
    sourceDocument: 'PRIV-STD-04',
    sourceSection: '§6.1/§6.5 (also PRIV-SOP-06)',
    rationale:
      'Data-sharing decision turnaround; figure sourced to PRIV-STD-04 §6.1/§6.5. Carries a shorter regulatory-channel variant.',
  },
  incident_containment: {
    sourceType: 'REGULATORY',
    sourceReference: 'Incident containment (M09)',
    sourceDocument: 'Governing Policy',
    sourceSection: '§12 (also PRIV-SOP-09)',
    rationale:
      'Breach-containment clock; figure sourced to the Governing Policy §12.',
  },
  incident_senior_management_notification: {
    sourceType: 'REGULATORY',
    sourceReference: 'Material incident — Senior Management notification (M09)',
    sourceDocument: 'Governing Policy',
    sourceSection: '§12 (also PRIV-SOP-09)',
    rationale:
      'Material-incident notification clock; figure sourced to the Governing Policy §12.',
  },
  dpia_review: {
    sourceType: 'REGULATORY',
    sourceReference: 'DPIA screening review (M10)',
    sourceDocument: 'PRIV-STD-01',
    sourceSection: '§6.6',
    rationale: 'DPIA review turnaround; figure sourced to PRIV-STD-01 §6.6.',
  },

  // --- OPERATIONAL: real, tracked, but no governing-document figure ---------
  vendor_termination_access_revocation: {
    sourceType: 'OPERATIONAL',
    sourceReference: 'Vendor access revocation on termination (M07)',
    sourceDocument: PDPL_REGISTRY,
    sourceSection: 'backlog Part C #71',
    rationale:
      'Deliberately NOT classified REGULATORY. The M07 obligation to revoke vendor access is real, but this entry\'s own citation states that "no independent PRIV-SOP figure [was] identified beyond the backlog" — so the DURATION has no governing-document source, and only the duration is what an SLA asserts. Classified down rather than up.',
  },
  renewal_workflow_start: {
    sourceType: 'OPERATIONAL',
    sourceReference: 'Renewal workflow start',
    sourceDocument: 'IBMS_Full_Scope_Context_Document.docx',
    sourceSection: 'Part 3.9',
    rationale:
      'A brokerage operating-model target from the business context document, not privacy regulation. Tracked in the same registry for convenience; that does not make it law.',
  },
  claim_followup_insurer_response: {
    sourceType: 'OPERATIONAL',
    sourceReference: 'Claim follow-up (insurer non-response)',
    sourceDocument: 'IBMS_Full_Scope_Context_Document.docx',
    sourceSection: 'Part 3.5 (Claims)',
    rationale:
      'A claims-handling operating target from the business context document. No regulator sets this figure.',
  },

  // --- INTERNAL_POLICY: drafted figures with no authority behind them -------
  // Every one of these carries "DRAFT, UNSOURCED" in its own citation. This is
  // the honest home for them, and the reason this table exists at all.
  kyc_standard_review: {
    sourceType: 'INTERNAL_POLICY',
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    rationale:
      "DRAFT, UNSOURCED. No PRIV-SOP/PRIV-STD or pdpl-sla-timers.md row covers KYC compliance-review turnaround — see ibms-brain/meta/lex/kyc-aml-sla-timers.md. A CBJ AML/CFT instruction or the broker's own AML policy should supply the real figure.",
  },
  kyc_edd_review: {
    sourceType: 'INTERNAL_POLICY',
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    rationale:
      'DRAFT, UNSOURCED. No governing document covers EDD review turnaround — see ibms-brain/meta/lex/kyc-aml-sla-timers.md.',
  },
  sanctions_match_review: {
    sourceType: 'INTERNAL_POLICY',
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    rationale:
      "DRAFT, UNSOURCED. Nothing covers turnaround for adjudicating a sanctions-list match. Drafted tighter than the standard KYC review because an unadjudicated match on a live customer is a live exposure — that reasoning is the broker's, not a regulator's.",
  },
  service_request_fulfilment: {
    sourceType: 'INTERNAL_POLICY',
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    rationale:
      'DRAFT, UNSOURCED. A published service-standard / contractual courtesy target, not a statutory SLA.',
  },
  complaint_resolution: {
    sourceType: 'INTERNAL_POLICY',
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    rationale:
      "DRAFT, UNSOURCED. CBJ conduct-of-business territory; a CBJ complaint-handling instruction should supply the real figure. Until one is cited this is the broker's own target.",
  },
};

/** `SLA-` + the workflow name upper-cased, e.g. `SLA-DSR-ACCESS-DELETION`. A
 * stable identifier governance documents can quote, which must not change when
 * the duration does. */
export function slaPolicyCodeFor(workflowName: string): string {
  return `SLA-${workflowName.toUpperCase().replace(/_/g, '-')}`;
}
