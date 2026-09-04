import type { SlaDuration } from '../../common/business-days.util';

/**
 * The machine-readable registry ibms-brain/meta/lex/pdpl-sla-timers.md asks
 * for: "This file [the lex table] is the source for that registry until one
 * exists in code — when it does, this table should be generated from it, not
 * maintained by hand in two places." This is that registry — backlog A.8.
 *
 * Each entry transcribes one row of that lex table's SLA registry, plus its
 * escalation path as an ordered list of stages. A stage's `offset` is signed
 * and relative to the workflow's own SLA due date (0 = the deadline itself);
 * a negative offset is an early-warning stage before the deadline (e.g.
 * DSR's T-3-business-days DPO alert). `escalateTo` is `null` where the
 * source table's Escalation column is "—" — the stage still exists (so the
 * deadline itself is a queryable, sweep-checked row, per the lex rule) even
 * though no named escalation target follows it.
 *
 * `escalateTo` values are free text (`SlaTimer.escalatedTo` has no enum/FK
 * constraint — see schema.prisma's comment "role or user escalated to").
 * Only `'DATA_PROTECTION_OFFICER'` matches a real `RoleName` today; the
 * others (General Manager, IT management, Customer Retention, Legal
 * Counsel) name a function the lex table calls out that has no
 * corresponding RBAC role yet — see
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md, which does
 * not mention any of them. Resolving a free-text target to a real
 * recipient (a role, a user, a distribution list) is a notification-system
 * concern this repo doesn't have yet (same gap as A.1's "no email provider"
 * — see README.md § Known gaps).
 *
 * Citations: the lex table row is the primary, verified source for every
 * SLA value here. The secondary citation per entry is the module-level
 * governing document from ibms-brain/meta/context/pcms-privacy-modules.md's
 * table — this file does not invent a PRIV-SRS-01 section number beyond
 * what that map already states, per that context file's own rule ("this
 * brain cross-references [PRIV-*], it never restates them as a second
 * source of truth").
 */

export interface SlaEscalationStage {
  offset: SlaDuration;
  escalateTo: string | null;
}

export interface SlaRegistryEntry {
  workflowName: string;
  label: string;
  /** Polymorphic `SlaTimer.entityType` / `AuditLogEntry.entityType` value
   * this workflow's timers are scoped to. */
  entityType: string;
  /** The default SLA duration — used by `computeSlaDueAt()` when a caller
   * has no domain-specific due-date field of its own to read instead (see
   * SlaTimerService's header comment for which of the 14 that applies to). */
  duration: SlaDuration;
  /** M08's regulatory-channel fast-track: 1 business day instead of the
   * standard 3. The only one of the 14 rows with a conditional duration. */
  regulatoryChannelDuration?: SlaDuration;
  escalationStages: readonly SlaEscalationStage[];
  citation: string;
}

const DSR_ESCALATION_STAGES: readonly SlaEscalationStage[] = [
  // "auto-escalate ... to the DPO ... any DSR within 3 business days of SLA
  // expiry that is not yet Closed" (pdpl-sla-timers.md rationale, quoting
  // PRIV-SRS-01).
  {
    offset: { value: -3, unit: 'businessDays' },
    escalateTo: 'DATA_PROTECTION_OFFICER',
  },
  // "... and, after 3 additional days, to the General Manager" — 3 business
  // days after the T-3 stage lands exactly on the SLA due date itself.
  { offset: { value: 0, unit: 'businessDays' }, escalateTo: 'GENERAL_MANAGER' },
];

export const SLA_REGISTRY: readonly SlaRegistryEntry[] = [
  {
    workflowName: 'consent_withdrawal',
    label: 'Consent withdrawal reflected in register',
    entityType: 'ConsentRecord',
    duration: { value: 2, unit: 'businessDays' },
    escalationStages: [
      { offset: { value: 0, unit: 'businessDays' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Consent withdrawal (M03)"; PRIV-STD-01 §6.3, PRIV-SOP-04',
  },
  {
    workflowName: 'dsr_access_deletion',
    label: 'DSR — Access / Deletion',
    entityType: 'DataSubjectRequest',
    // Access-only +15 business-day extension is a domain-level re-basing of
    // slaDueAt (extensionReason logged) — out of scope for this generic
    // registry entry; see SlaTimerService's header comment.
    duration: { value: 15, unit: 'businessDays' },
    escalationStages: DSR_ESCALATION_STAGES,
    citation:
      'pdpl-sla-timers.md row "DSR — Access / Deletion (M04)"; PRIV-STD-01 §6.4, PRIV-SOP-05',
  },
  {
    workflowName: 'dsr_correction_objection',
    label: 'DSR — Correction / Objection',
    entityType: 'DataSubjectRequest',
    duration: { value: 10, unit: 'businessDays' },
    escalationStages: DSR_ESCALATION_STAGES,
    citation:
      'pdpl-sla-timers.md row "DSR — Correction / Objection (M04)"; PRIV-STD-01 §6.4, PRIV-SOP-05',
  },
  {
    workflowName: 'termination_access_revocation',
    label: 'Termination access revocation',
    entityType: 'AccessDeprovisioningChecklist',
    duration: { value: 0, unit: 'hours' }, // same business day as trigger
    escalationStages: [
      { offset: { value: 24, unit: 'hours' }, escalateTo: 'IT_MANAGEMENT' },
    ],
    citation:
      'pdpl-sla-timers.md row "Termination access revocation (M05)"; PRIV-STD-02, PRIV-SOP-01/02/03',
  },
  {
    workflowName: 'quarterly_access_review',
    label: 'Quarterly access review',
    entityType: 'AccessRecertificationCycle',
    duration: { value: 15, unit: 'businessDays' },
    escalationStages: [
      { offset: { value: 0, unit: 'businessDays' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Quarterly access review (M05)"; PRIV-STD-02, PRIV-SOP-01/02/03',
  },
  {
    workflowName: 'disposal_batch_execution',
    label: 'Disposal batch execution',
    entityType: 'DisposalBatch',
    duration: { value: 30, unit: 'calendarDays' },
    escalationStages: [
      // "Feeds KPI: % disposal batches completed within 30 days" — no named
      // escalation target, but still a sweep-checked deadline.
      { offset: { value: 0, unit: 'calendarDays' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Disposal batch execution (M06)"; PRIV-STD-03, PRIV-SOP-07/08',
  },
  {
    workflowName: 'legal_hold_necessity_review',
    label: 'Legal Hold necessity review',
    entityType: 'LegalHold',
    duration: { value: 6, unit: 'months' },
    escalationStages: [
      {
        offset: { value: 0, unit: 'months' },
        escalateTo: 'DPO_AND_LEGAL_COUNSEL',
      },
    ],
    citation:
      'pdpl-sla-timers.md row "Legal Hold necessity review (M06)"; PRIV-STD-03, PRIV-SOP-07/08',
  },
  {
    workflowName: 'vendor_annual_review',
    label: 'Vendor annual review (Medium/High tier)',
    entityType: 'Vendor',
    duration: { value: 12, unit: 'months' },
    escalationStages: [
      { offset: { value: 0, unit: 'months' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Vendor annual review (M07)"; PRIV-STD-04, PRIV-SOP-10',
  },
  {
    workflowName: 'data_sharing_decision',
    label: 'Data sharing decision',
    entityType: 'DataSharingApproval',
    duration: { value: 3, unit: 'businessDays' },
    regulatoryChannelDuration: { value: 1, unit: 'businessDays' },
    escalationStages: [
      { offset: { value: 0, unit: 'businessDays' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Data sharing decision (M08)"; PRIV-STD-04 §6.1/§6.5, PRIV-SOP-06',
  },
  {
    workflowName: 'incident_containment',
    label: 'Incident containment (critical severity)',
    entityType: 'IncidentReport',
    duration: { value: 4, unit: 'hours' },
    escalationStages: [
      { offset: { value: 0, unit: 'hours' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Incident containment (M09)"; Governing Policy §12, PRIV-SOP-09',
  },
  {
    workflowName: 'incident_senior_management_notification',
    label: 'Material incident — Senior Management notification',
    entityType: 'IncidentReport',
    duration: { value: 1, unit: 'hours' },
    escalationStages: [
      { offset: { value: 0, unit: 'hours' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "Material incident — Senior Management notification (M09)"; Governing Policy §12, PRIV-SOP-09',
  },
  {
    workflowName: 'dpia_review',
    label: 'DPIA screening review',
    entityType: 'DpiaScreening',
    duration: { value: 5, unit: 'businessDays' },
    escalationStages: [
      { offset: { value: 0, unit: 'businessDays' }, escalateTo: null },
    ],
    citation:
      'pdpl-sla-timers.md row "DPIA screening review (M10)"; PRIV-STD-01 §6.6',
  },
  {
    workflowName: 'renewal_workflow_start',
    label: 'Renewal workflow start',
    entityType: 'RenewalCase',
    // Default lead time; RenewalCase.leadTimeDays is per-case configurable —
    // callers with a non-default lead time should pass their own dueAt
    // rather than call computeSlaDueAt() with this default.
    duration: { value: 90, unit: 'calendarDays' },
    escalationStages: [
      {
        offset: { value: 0, unit: 'calendarDays' },
        escalateTo: 'CUSTOMER_RETENTION',
      },
    ],
    citation:
      'pdpl-sla-timers.md row "Renewal workflow start"; IBMS_Full_Scope_Context_Document.docx Part 3.9',
  },
  {
    workflowName: 'claim_followup_insurer_response',
    label: 'Claim follow-up (insurer non-response)',
    entityType: 'Claim',
    // Configurable per line — 9 days is the lex table's example, not a fixed
    // rule; callers should pass their own dueAt when a line has a different
    // configured follow-up window.
    duration: { value: 9, unit: 'calendarDays' },
    escalationStages: [
      {
        offset: { value: 0, unit: 'calendarDays' },
        escalateTo: 'CLAIMS_OFFICER',
      },
    ],
    citation:
      'pdpl-sla-timers.md row "Claim follow-up (insurer non-response)"; IBMS_Full_Scope_Context_Document.docx Part 3.5 (Claims); see also ClaimFollowUpAlert in schema.prisma',
  },
  // Backlog Part C #3-4 (Customer Acquisition/Onboarding) asks for "a
  // separate, longer SLA" on the EDD path, but — unlike every entry above —
  // NEITHER of these two rows has a source in pdpl-sla-timers.md's registry
  // (that table is PDPL-driven; KYC/EDD turnaround is a CBJ AML
  // customer-due-diligence timing question, a different regulatory domain
  // entirely). The durations below are a drafted default, not a sourced
  // fact: 5 business days standard reuses this same table's DPIA-review
  // figure as a reasonable "compliance review turnaround" analog; 15
  // business days EDD reuses the DSR figure as the established "long"
  // analog for a deeper review. Tracked as a brain gap in
  // ibms-brain/meta/lex/kyc-aml-sla-timers.md (filed via `/brain-gap`) —
  // do not cite this pair as PRIV-SOP/PRIV-STD-sourced in a PR the way the
  // other 14 rows are.
  {
    workflowName: 'kyc_standard_review',
    label: 'KYC compliance review (standard)',
    entityType: 'KYCRecord',
    duration: { value: 5, unit: 'businessDays' },
    escalationStages: [
      { offset: { value: 0, unit: 'businessDays' }, escalateTo: null },
    ],
    citation:
      'DRAFT, UNSOURCED — see ibms-brain/meta/lex/kyc-aml-sla-timers.md (no PRIV-SOP/PRIV-STD or pdpl-sla-timers.md row covers KYC/AML review turnaround)',
  },
  {
    workflowName: 'kyc_edd_review',
    label: 'KYC compliance review (enhanced due diligence)',
    entityType: 'KYCRecord',
    duration: { value: 15, unit: 'businessDays' },
    escalationStages: [
      {
        offset: { value: 0, unit: 'businessDays' },
        escalateTo: 'COMPLIANCE_OFFICER',
      },
    ],
    citation:
      'DRAFT, UNSOURCED — see ibms-brain/meta/lex/kyc-aml-sla-timers.md (no PRIV-SOP/PRIV-STD or pdpl-sla-timers.md row covers KYC/AML EDD review turnaround)',
  },
  // Backlog Part C #41 (Customer Requests, Domain E). Like the two KYC rows
  // above — but UNLIKE the 14 PDPL rows — this has NO source in
  // pdpl-sla-timers.md's registry: a customer-service-request turnaround is a
  // published service-standard / contractual courtesy target, not a PDPL
  // statutory SLA, and Part 3.8 of the context document names no figure. The
  // 5-business-day default below is a DRAFTED analog (the same figure this
  // table already uses for DPIA review / KYC standard as a reasonable
  // "internal review turnaround"). The backlog line explicitly names
  // `SlaTimer`, so it is tracked here (not merely as a KPI); replace with a
  // sourced figure when a broker service charter / SOP supplies one. Filed as
  // a brain gap in ibms-brain/meta/context/customer-service-lifecycle.md.
  {
    workflowName: 'service_request_fulfilment',
    label: 'Customer service request fulfilment',
    entityType: 'ServiceRequest',
    duration: { value: 5, unit: 'businessDays' },
    escalationStages: [
      {
        offset: { value: 0, unit: 'businessDays' },
        escalateTo: 'BRANCH_DEPARTMENT_MANAGER',
      },
    ],
    citation:
      'DRAFT, UNSOURCED — no PRIV-SOP/PRIV-STD or pdpl-sla-timers.md row covers customer-service-request turnaround; Part 3.8 names no figure. See ibms-brain/meta/context/customer-service-lifecycle.md',
  },
  // Backlog Part C #42 (Complaints Management, Domain E). Like the KYC and
  // service-request rows above, this has NO source in pdpl-sla-timers.md's
  // registry: a customer-complaint resolution turnaround is a CBJ insurance
  // conduct-of-business matter (the CBJ Insurance Dispute Resolution
  // Committee, which `EscalationRecord` routes to, is a real CBJ mechanism),
  // NOT a PDPL statutory SLA — and Part 3.8 of the context document names no
  // figure. 10 business days below is a DRAFTED analog (this table's DSR
  // correction/objection figure, a reasonable "substantive response"
  // window). The backlog line explicitly names `SlaTimer`, so it is tracked
  // here (with the nightly escalation sweep to the internal supervisor);
  // replace with a sourced figure when a CBJ complaint-handling instruction
  // or a broker SOP supplies one. Filed as a brain gap in
  // ibms-brain/meta/context/customer-service-lifecycle.md.
  {
    workflowName: 'complaint_resolution',
    label: 'Customer complaint resolution',
    entityType: 'Complaint',
    duration: { value: 10, unit: 'businessDays' },
    escalationStages: [
      {
        offset: { value: 0, unit: 'businessDays' },
        escalateTo: 'BRANCH_DEPARTMENT_MANAGER',
      },
    ],
    citation:
      'DRAFT, UNSOURCED — no PRIV-SOP/PRIV-STD or pdpl-sla-timers.md row covers customer-complaint resolution turnaround; Part 3.8 names no figure (CBJ conduct-of-business, not PDPL). See ibms-brain/meta/context/customer-service-lifecycle.md',
  },
];

const SLA_REGISTRY_BY_NAME = new Map(
  SLA_REGISTRY.map((entry) => [entry.workflowName, entry]),
);

export function getSlaRegistryEntry(workflowName: string): SlaRegistryEntry {
  const entry = SLA_REGISTRY_BY_NAME.get(workflowName);
  if (!entry) {
    throw new Error(
      `Unknown SLA workflow "${workflowName}" — not present in SLA_REGISTRY (sla-registry.config.ts)`,
    );
  }
  return entry;
}

/**
 * Non-throwing sibling of {@link getSlaRegistryEntry} — returns `undefined`
 * for an unknown `workflowName` instead of throwing. Used by the Process 43
 * SLA dashboard, which reads persisted `SlaTimer.workflowName` values that
 * could name a workflow since renamed or removed from the registry: a
 * monitoring view must degrade gracefully (fall back to the raw name), not
 * crash on a legacy row.
 */
export function findSlaRegistryEntry(
  workflowName: string,
): SlaRegistryEntry | undefined {
  return SLA_REGISTRY_BY_NAME.get(workflowName);
}
