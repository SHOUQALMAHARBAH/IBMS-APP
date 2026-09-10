// GENERATED FILE — do not edit by hand.
//
// Source of truth:
//   apps/api/src/modules/sla/sla-registry.config.ts      (durations, stages)
//   apps/api/src/modules/sla/sla-policy-source.config.ts (provenance)
//
// Regenerate: npx tsx scripts/generate-sla-policy-seed.ts
// Guarded by: apps/api/src/modules/sla/sla-policy-seed-drift.spec.ts
//
// `packages/db` cannot import from `apps/api`, which is why this copy
// exists. The drift spec is what stops it becoming a second, wrong source.

export interface SlaPolicySeed {
  policyCode: string;
  policyName: string;
  processType: string;
  description: string;
  durationValue: number;
  durationUnit:
    "MINUTES" | "HOURS" | "BUSINESS_DAYS" | "CALENDAR_DAYS" | "MONTHS";
  calendarType: "JORDAN_STANDARD" | "CONTINUOUS_24_7" | "CUSTOM";
  sourceType:
    "REGULATORY" | "INTERNAL_POLICY" | "CONTRACTUAL" | "OPERATIONAL" | "OTHER";
  sourceReference: string | null;
  sourceDocument: string | null;
  sourceSection: string | null;
  escalations: {
    stageOrder: number;
    offsetValue: number;
    offsetUnit:
      "MINUTES" | "HOURS" | "BUSINESS_DAYS" | "CALENDAR_DAYS" | "MONTHS";
    escalateTo: string | null;
  }[];
}

export const SLA_POLICY_SEEDS: SlaPolicySeed[] = [
  {
    policyCode: "SLA-CONSENT-WITHDRAWAL",
    policyName: "Consent withdrawal reflected in register",
    processType: "consent_withdrawal",
    description:
      "PDPL consent-withdrawal deadline; figure carried by ibms-brain/meta/lex/pdpl-sla-timers.md and sourced to PRIV-STD-01 §6.3.",
    durationValue: 2,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "Consent withdrawal (M03)",
    sourceDocument: "PRIV-STD-01",
    sourceSection: "§6.3 (also PRIV-SOP-04)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-DSR-ACCESS-DELETION",
    policyName: "DSR — Access / Deletion",
    processType: "dsr_access_deletion",
    description:
      "Statutory data-subject-request turnaround. PRIV-STD-01 §6.4 is the source of the figure.",
    durationValue: 15,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "DSR — Access / Deletion (M04)",
    sourceDocument: "PRIV-STD-01",
    sourceSection: "§6.4 (also PRIV-SOP-05)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: -3,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "DATA_PROTECTION_OFFICER",
      },
      {
        stageOrder: 1,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "GENERAL_MANAGER",
      },
    ],
  },
  {
    policyCode: "SLA-DSR-CORRECTION-OBJECTION",
    policyName: "DSR — Correction / Objection",
    processType: "dsr_correction_objection",
    description:
      "Statutory data-subject-request turnaround. PRIV-STD-01 §6.4 is the source of the figure.",
    durationValue: 10,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "DSR — Correction / Objection (M04)",
    sourceDocument: "PRIV-STD-01",
    sourceSection: "§6.4 (also PRIV-SOP-05)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: -3,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "DATA_PROTECTION_OFFICER",
      },
      {
        stageOrder: 1,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "GENERAL_MANAGER",
      },
    ],
  },
  {
    policyCode: "SLA-TERMINATION-ACCESS-REVOCATION",
    policyName: "Termination access revocation",
    processType: "termination_access_revocation",
    description:
      "Access-control obligation on termination; figure sourced to PRIV-STD-02.",
    durationValue: 0,
    durationUnit: "HOURS",
    calendarType: "CONTINUOUS_24_7",
    sourceType: "REGULATORY",
    sourceReference: "Termination access revocation (M05)",
    sourceDocument: "PRIV-STD-02",
    sourceSection: "PRIV-SOP-01/02/03",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 24,
        offsetUnit: "HOURS",
        escalateTo: "IT_MANAGEMENT",
      },
    ],
  },
  {
    policyCode: "SLA-QUARTERLY-ACCESS-REVIEW",
    policyName: "Quarterly access review",
    processType: "quarterly_access_review",
    description:
      "Periodic access-recertification cadence; figure sourced to PRIV-STD-02.",
    durationValue: 15,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "Quarterly access review (M05)",
    sourceDocument: "PRIV-STD-02",
    sourceSection: "PRIV-SOP-01/02/03",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-DISPOSAL-BATCH-EXECUTION",
    policyName: "Disposal batch execution",
    processType: "disposal_batch_execution",
    description:
      "Retention/disposal execution deadline; figure sourced to PRIV-STD-03.",
    durationValue: 30,
    durationUnit: "CALENDAR_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "Disposal batch execution (M06)",
    sourceDocument: "PRIV-STD-03",
    sourceSection: "PRIV-SOP-07/08",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "CALENDAR_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-LEGAL-HOLD-NECESSITY-REVIEW",
    policyName: "Legal Hold necessity review",
    processType: "legal_hold_necessity_review",
    description: "Legal-hold review cadence; figure sourced to PRIV-STD-03.",
    durationValue: 6,
    durationUnit: "MONTHS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "Legal Hold necessity review (M06)",
    sourceDocument: "PRIV-STD-03",
    sourceSection: "PRIV-SOP-07/08",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "MONTHS",
        escalateTo: "DPO_AND_LEGAL_COUNSEL",
      },
    ],
  },
  {
    policyCode: "SLA-VENDOR-ANNUAL-REVIEW",
    policyName: "Vendor annual review (Medium/High tier)",
    processType: "vendor_annual_review",
    description:
      "Third-party/processor review cadence; figure sourced to PRIV-STD-04.",
    durationValue: 12,
    durationUnit: "MONTHS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "Vendor annual review (M07)",
    sourceDocument: "PRIV-STD-04",
    sourceSection: "PRIV-SOP-10",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "MONTHS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-VENDOR-TERMINATION-ACCESS-REVOCATION",
    policyName: "Vendor access revocation on termination",
    processType: "vendor_termination_access_revocation",
    description:
      'Deliberately NOT classified REGULATORY. The M07 obligation to revoke vendor access is real, but this entry\'s own citation states that "no independent PRIV-SOP figure [was] identified beyond the backlog" — so the DURATION has no governing-document source, and only the duration is what an SLA asserts. Classified down rather than up.',
    durationValue: 2,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "OPERATIONAL",
    sourceReference: "Vendor access revocation on termination (M07)",
    sourceDocument: "ibms-brain/meta/lex/pdpl-sla-timers.md",
    sourceSection: "backlog Part C #71",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-DATA-SHARING-DECISION",
    policyName: "Data sharing decision",
    processType: "data_sharing_decision",
    description:
      "Data-sharing decision turnaround; figure sourced to PRIV-STD-04 §6.1/§6.5. Carries a shorter regulatory-channel variant.",
    durationValue: 3,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "Data sharing decision (M08)",
    sourceDocument: "PRIV-STD-04",
    sourceSection: "§6.1/§6.5 (also PRIV-SOP-06)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-INCIDENT-CONTAINMENT",
    policyName: "Incident containment (critical severity)",
    processType: "incident_containment",
    description:
      "Breach-containment clock; figure sourced to the Governing Policy §12.",
    durationValue: 4,
    durationUnit: "HOURS",
    calendarType: "CONTINUOUS_24_7",
    sourceType: "REGULATORY",
    sourceReference: "Incident containment (M09)",
    sourceDocument: "Governing Policy",
    sourceSection: "§12 (also PRIV-SOP-09)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "HOURS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-INCIDENT-SENIOR-MANAGEMENT-NOTIFICATION",
    policyName: "Material incident — Senior Management notification",
    processType: "incident_senior_management_notification",
    description:
      "Material-incident notification clock; figure sourced to the Governing Policy §12.",
    durationValue: 1,
    durationUnit: "HOURS",
    calendarType: "CONTINUOUS_24_7",
    sourceType: "REGULATORY",
    sourceReference: "Material incident — Senior Management notification (M09)",
    sourceDocument: "Governing Policy",
    sourceSection: "§12 (also PRIV-SOP-09)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "HOURS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-DPIA-REVIEW",
    policyName: "DPIA screening review",
    processType: "dpia_review",
    description: "DPIA review turnaround; figure sourced to PRIV-STD-01 §6.6.",
    durationValue: 5,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "REGULATORY",
    sourceReference: "DPIA screening review (M10)",
    sourceDocument: "PRIV-STD-01",
    sourceSection: "§6.6",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-RENEWAL-WORKFLOW-START",
    policyName: "Renewal workflow start",
    processType: "renewal_workflow_start",
    description:
      "A brokerage operating-model target from the business context document, not privacy regulation. Tracked in the same registry for convenience; that does not make it law.",
    durationValue: 90,
    durationUnit: "CALENDAR_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "OPERATIONAL",
    sourceReference: "Renewal workflow start",
    sourceDocument: "IBMS_Full_Scope_Context_Document.docx",
    sourceSection: "Part 3.9",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "CALENDAR_DAYS",
        escalateTo: "CUSTOMER_RETENTION",
      },
    ],
  },
  {
    policyCode: "SLA-CLAIM-FOLLOWUP-INSURER-RESPONSE",
    policyName: "Claim follow-up (insurer non-response)",
    processType: "claim_followup_insurer_response",
    description:
      "A claims-handling operating target from the business context document. No regulator sets this figure.",
    durationValue: 9,
    durationUnit: "CALENDAR_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "OPERATIONAL",
    sourceReference: "Claim follow-up (insurer non-response)",
    sourceDocument: "IBMS_Full_Scope_Context_Document.docx",
    sourceSection: "Part 3.5 (Claims)",
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "CALENDAR_DAYS",
        escalateTo: "CLAIMS_OFFICER",
      },
    ],
  },
  {
    policyCode: "SLA-KYC-STANDARD-REVIEW",
    policyName: "KYC compliance review (standard)",
    processType: "kyc_standard_review",
    description:
      "DRAFT, UNSOURCED. No PRIV-SOP/PRIV-STD or pdpl-sla-timers.md row covers KYC compliance-review turnaround — see ibms-brain/meta/lex/kyc-aml-sla-timers.md. A CBJ AML/CFT instruction or the broker's own AML policy should supply the real figure.",
    durationValue: 5,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "INTERNAL_POLICY",
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: null,
      },
    ],
  },
  {
    policyCode: "SLA-KYC-EDD-REVIEW",
    policyName: "KYC compliance review (enhanced due diligence)",
    processType: "kyc_edd_review",
    description:
      "DRAFT, UNSOURCED. No governing document covers EDD review turnaround — see ibms-brain/meta/lex/kyc-aml-sla-timers.md.",
    durationValue: 15,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "INTERNAL_POLICY",
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "COMPLIANCE_OFFICER",
      },
    ],
  },
  {
    policyCode: "SLA-SANCTIONS-MATCH-REVIEW",
    policyName: "Sanctions match review (Compliance adjudication)",
    processType: "sanctions_match_review",
    description:
      "DRAFT, UNSOURCED. Nothing covers turnaround for adjudicating a sanctions-list match. Drafted tighter than the standard KYC review because an unadjudicated match on a live customer is a live exposure — that reasoning is the broker's, not a regulator's.",
    durationValue: 3,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "INTERNAL_POLICY",
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "COMPLIANCE_OFFICER",
      },
    ],
  },
  {
    policyCode: "SLA-SERVICE-REQUEST-FULFILMENT",
    policyName: "Customer service request fulfilment",
    processType: "service_request_fulfilment",
    description:
      "DRAFT, UNSOURCED. A published service-standard / contractual courtesy target, not a statutory SLA.",
    durationValue: 5,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "INTERNAL_POLICY",
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "BRANCH_DEPARTMENT_MANAGER",
      },
    ],
  },
  {
    policyCode: "SLA-COMPLAINT-RESOLUTION",
    policyName: "Customer complaint resolution",
    processType: "complaint_resolution",
    description:
      "DRAFT, UNSOURCED. CBJ conduct-of-business territory; a CBJ complaint-handling instruction should supply the real figure. Until one is cited this is the broker's own target.",
    durationValue: 10,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    sourceType: "INTERNAL_POLICY",
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    escalations: [
      {
        stageOrder: 0,
        offsetValue: 0,
        offsetUnit: "BUSINESS_DAYS",
        escalateTo: "BRANCH_DEPARTMENT_MANAGER",
      },
    ],
  },
];
