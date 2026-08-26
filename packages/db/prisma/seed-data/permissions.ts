import { RoleName } from '@prisma/client';

/**
 * Part 5.1 / Process #40 — the full permission grid. One independent
 * permission code per sensitive action named in the Part C business-module
 * backlog (74 processes across 8 domains) plus Part D (PDPL/M-series) and
 * the admin/RBAC surface this task itself adds.
 *
 * Naming convention: `<entity>.<action>`, read/list actions end in `.read`
 * or `.view` (see the EXTERNAL_AUDITOR test in permissions.spec.ts, which
 * relies on that suffix to assert the role is read-only by construction,
 * not by a hand-maintained exclusion list).
 *
 * Role assignment follows the Can/Cannot table in
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md. Where that
 * table's "Cannot" column is instance-level (e.g. "cannot approve their OWN
 * refund") rather than role-level, the permission is still granted to the
 * role — instance-level maker != checker enforcement is
 * ibms-brain/meta/lex/maker-checker-segregation.md's job (backlog item A.5),
 * not this grid's.
 *
 * Part C business modules (Lead, Policy, Claim, ...) have no application
 * code yet — these codes exist now so each module adopts an existing code
 * instead of inventing one when it lands.
 */
export interface PermissionSeed {
  code: string;
  module: string;
  description: string;
  roles: RoleName[];
}

const SALES = RoleName.SALES_RELATIONSHIP_OFFICER;
const PLACEMENT = RoleName.PLACEMENT_TECHNICAL_OFFICER;
const POLICY_CHECK = RoleName.POLICY_CHECKING_OFFICER;
const CLAIMS = RoleName.CLAIMS_OFFICER;
const FINANCE = RoleName.FINANCE_COLLECTIONS_OFFICER;
const COMPLIANCE = RoleName.COMPLIANCE_OFFICER;
const MANAGER = RoleName.BRANCH_DEPARTMENT_MANAGER;
const DPO = RoleName.DATA_PROTECTION_OFFICER;
const ADMIN = RoleName.SYSTEM_SECURITY_ADMINISTRATOR;
const EXEC = RoleName.EXECUTIVE_MANAGEMENT;
const AUDITOR = RoleName.EXTERNAL_AUDITOR;

// ----------------------------------------------------------------------
// Domain A — Commercial / Front Office (Processes 1-10)
// ----------------------------------------------------------------------
const commercialFrontOffice: PermissionSeed[] = [
  { code: 'lead.create', module: 'commercial-front-office', description: 'Create a Lead', roles: [SALES] },
  { code: 'lead.list.read', module: 'commercial-front-office', description: 'List/filter leads', roles: [SALES, MANAGER, EXEC] },
  { code: 'lead.transition', module: 'commercial-front-office', description: 'Transition LeadStatus', roles: [SALES] },
  { code: 'prospect.capture', module: 'commercial-front-office', description: 'Convert/qualify a Lead into a Prospect', roles: [SALES] },
  { code: 'prospect.read', module: 'commercial-front-office', description: 'List/read Prospect profiles', roles: [SALES, MANAGER, EXEC] },
  { code: 'customer.create', module: 'commercial-front-office', description: 'Create a Customer (individual/corporate)', roles: [SALES] },
  { code: 'kyc.capture', module: 'commercial-front-office', description: 'Capture KYC data and supporting documents', roles: [SALES] },
  { code: 'ubo.record', module: 'commercial-front-office', description: 'Record Ultimate Beneficial Owners for a corporate customer', roles: [SALES, COMPLIANCE] },
  { code: 'screening.run', module: 'commercial-front-office', description: 'Run sanctions/PEP/AML screening', roles: [COMPLIANCE] },
  { code: 'kyc.edd.trigger', module: 'commercial-front-office', description: 'Trigger the enhanced due-diligence path on a high-risk result', roles: [COMPLIANCE] },
  { code: 'kyc.approve', module: 'commercial-front-office', description: 'Approve a KYC file and activate the Customer (maker/checker: capturer != approver)', roles: [COMPLIANCE] },
  { code: 'kyc.review.schedule', module: 'commercial-front-office', description: 'Schedule periodic re-KYC by risk classification', roles: [COMPLIANCE] },
  { code: 'needs-assessment.create', module: 'commercial-front-office', description: 'Capture a Needs Assessment questionnaire', roles: [SALES] },
  { code: 'needs-assessment.approve', module: 'commercial-front-office', description: 'Review and approve a Needs Assessment before linking to an Opportunity/RFQ', roles: [MANAGER] },
  { code: 'risk-profile.create', module: 'commercial-front-office', description: 'Capture a detailed risk survey (Risk Profile/Asset)', roles: [SALES, PLACEMENT] },
  { code: 'program.assemble', module: 'commercial-front-office', description: 'Assemble a multi-line Insurance Program from risk-assessment results', roles: [PLACEMENT] },
  { code: 'cross-sell.convert', module: 'commercial-front-office', description: 'Convert or dismiss a system-flagged cross-sell opportunity', roles: [SALES] },
  { code: 'up-sell.convert', module: 'commercial-front-office', description: 'Act on a system-flagged up-sell recommendation', roles: [SALES] },
  { code: 'interaction.log', module: 'commercial-front-office', description: 'Log a customer interaction (meeting/call/email/...)', roles: [SALES, PLACEMENT, CLAIMS, FINANCE, COMPLIANCE, MANAGER] },
  { code: 'customer.360-view.read', module: 'commercial-front-office', description: 'Read the aggregated 360° customer view', roles: [SALES, MANAGER, EXEC, COMPLIANCE, AUDITOR] },
];

// ----------------------------------------------------------------------
// Domain B — Insurance Operations (Processes 11-22)
// ----------------------------------------------------------------------
const insuranceOperations: PermissionSeed[] = [
  { code: 'rfq.create', module: 'insurance-operations', description: 'Create an RFQ and select an insurer shortlist', roles: [PLACEMENT] },
  { code: 'rfq.insurer.update', module: 'insurance-operations', description: "Update an insurer's RFQ response status", roles: [PLACEMENT] },
  { code: 'quotation.capture', module: 'insurance-operations', description: "Capture an insurer's quotation", roles: [PLACEMENT] },
  { code: 'quotation.negotiate', module: 'insurance-operations', description: 'Record a renegotiation round as a new quotation version', roles: [PLACEMENT] },
  { code: 'comparison.build', module: 'insurance-operations', description: 'Build/review the quote comparison matrix', roles: [PLACEMENT] },
  { code: 'recommendation.draft', module: 'insurance-operations', description: 'Draft the broker recommendation with documented rationale', roles: [PLACEMENT] },
  { code: 'recommendation.approve', module: 'insurance-operations', description: 'Approve a recommendation above the configurable premium threshold before it is sent to the client', roles: [MANAGER] },
  { code: 'conflict-of-interest.disclose', module: 'insurance-operations', description: 'Record a mandatory conflict-of-interest disclosure', roles: [PLACEMENT, COMPLIANCE] },
  { code: 'client-decision.capture', module: 'insurance-operations', description: "Capture the client's decision on a recommendation", roles: [SALES, PLACEMENT] },
  { code: 'policy.create', module: 'insurance-operations', description: 'Create a Policy from an accepted Opportunity', roles: [PLACEMENT] },
  { code: 'policy.issue', module: 'insurance-operations', description: 'Record the insurer-issued policy/schedule/certificates/invoice', roles: [PLACEMENT] },
  { code: 'policy.check', module: 'insurance-operations', description: 'Independently check an issued policy against requested coverage (maker/checker: never the officer who placed it)', roles: [POLICY_CHECK] },
  { code: 'policy.deliver', module: 'insurance-operations', description: 'Record policy delivery date/method/recipient/acknowledgement', roles: [SALES, PLACEMENT] },
  { code: 'endorsement.create', module: 'insurance-operations', description: 'Request a positive/negative endorsement', roles: [PLACEMENT] },
  { code: 'endorsement.apply', module: 'insurance-operations', description: 'Apply a confirmed endorsement and version the policy schedule', roles: [PLACEMENT] },
  { code: 'cancellation.create', module: 'insurance-operations', description: 'Raise a cancellation request (short-period/pro-rata)', roles: [PLACEMENT] },
  { code: 'refund.raise', module: 'insurance-operations', description: 'Raise a refund (maker side)', roles: [PLACEMENT, FINANCE] },
  { code: 'refund.approve', module: 'insurance-operations', description: 'Approve a refund above the configurable value threshold (maker/checker: never the raiser)', roles: [MANAGER] },
  { code: 'commission-reversal.create', module: 'insurance-operations', description: 'Record a commission reversal tied 1:1 to a negative premium adjustment', roles: [FINANCE] },
];

// ----------------------------------------------------------------------
// Domain C — Claims (Processes 23-30)
// ----------------------------------------------------------------------
const claims: PermissionSeed[] = [
  { code: 'claim.notify', module: 'claims', description: 'Record a claim notification (loss date/location/cause/estimate)', roles: [SALES, CLAIMS] },
  { code: 'claim.register', module: 'claims', description: 'Register a claim with the insurer and assign the adjuster', roles: [CLAIMS] },
  { code: 'claim.document', module: 'claims', description: 'Attach mandatory claim documentation', roles: [CLAIMS] },
  { code: 'claim.assess', module: 'claims', description: 'Track claim survey/investigation and log status changes', roles: [CLAIMS] },
  { code: 'claim.followup.manage', module: 'claims', description: 'Manage claim follow-up alerts', roles: [CLAIMS] },
  { code: 'claim.settle.approve', module: 'claims', description: 'Approve a claim settlement (first approver)', roles: [CLAIMS, MANAGER] },
  { code: 'claim.settle.second-approve', module: 'claims', description: 'Second-approve a large claim settlement or any broker-processed claim payment (never the same person as the first approver)', roles: [MANAGER, FINANCE] },
  { code: 'claim.close', module: 'claims', description: "Close a claim after the client's receipt of payment is confirmed", roles: [CLAIMS] },
  { code: 'claim.delete', module: 'claims', description: 'Delete a claim record — disabled by default, logged privileged override only', roles: [ADMIN] },
  { code: 'claims-analytics.view', module: 'claims', description: 'View Loss Ratio and claims analytics', roles: [CLAIMS, MANAGER, EXEC, AUDITOR] },
];

// ----------------------------------------------------------------------
// Domain D — Finance (Processes 31-40)
// ----------------------------------------------------------------------
const finance: PermissionSeed[] = [
  { code: 'invoice.create', module: 'finance', description: 'Raise a premium invoice', roles: [FINANCE] },
  { code: 'receipt.record', module: 'finance', description: 'Record a collection receipt', roles: [FINANCE] },
  { code: 'remittance.record', module: 'finance', description: 'Record a remittance to an insurer', roles: [FINANCE] },
  { code: 'client-accounting.read', module: 'finance', description: 'View the client accounts-receivable/ageing report', roles: [FINANCE, MANAGER, EXEC, AUDITOR] },
  { code: 'insurer-accounting.read', module: 'finance', description: 'View insurer accounts-payable/remittance obligations', roles: [FINANCE, MANAGER, EXEC, AUDITOR] },
  { code: 'commission.calculate', module: 'finance', description: 'Apply the governed commission rate from the agreement table', roles: [FINANCE] },
  { code: 'commission-rate.manage', module: 'finance', description: 'Alter a commission rate agreement/table (Finance may never do this without approval)', roles: [COMPLIANCE, MANAGER] },
  { code: 'commission-override.raise', module: 'finance', description: 'Raise a manual commission override with a mandatory reason', roles: [FINANCE] },
  { code: 'commission-override.approve', module: 'finance', description: 'Approve a manual commission override (separately logged from the raiser)', roles: [MANAGER] },
  { code: 'reconciliation-exception.investigate', module: 'finance', description: 'Investigate a bank-reconciliation variance exception', roles: [FINANCE] },
  { code: 'reconciliation-exception.resolve', module: 'finance', description: 'Close a reconciliation exception', roles: [FINANCE, MANAGER] },
  { code: 'financial-report.view', module: 'finance', description: 'View financial reporting/dashboards', roles: [FINANCE, MANAGER, EXEC, AUDITOR] },
];

// ----------------------------------------------------------------------
// Domain E — Customer Service (Processes 41-46)
// ----------------------------------------------------------------------
const customerService: PermissionSeed[] = [
  { code: 'service-request.manage', module: 'customer-service', description: 'Handle a customer service request (certificate/copy/change)', roles: [SALES, MANAGER] },
  { code: 'complaint.log', module: 'customer-service', description: 'Log a complaint', roles: [SALES, CLAIMS, FINANCE, COMPLIANCE, MANAGER] },
  { code: 'complaint.close', module: 'customer-service', description: 'Close a complaint (mandatory supervisor sign-off)', roles: [MANAGER] },
  { code: 'complaint.escalate', module: 'customer-service', description: 'Escalate a complaint to the Insurance Dispute Resolution Committee', roles: [MANAGER, COMPLIANCE] },
  { code: 'sla-dashboard.view', module: 'customer-service', description: 'Monitor the SLA dashboard across modules', roles: [COMPLIANCE, MANAGER, EXEC, AUDITOR] },
  { code: 'communication.send', module: 'customer-service', description: 'Send a logged customer communication (channel/consent-checked)', roles: [SALES, PLACEMENT, CLAIMS, FINANCE] },
  { code: 'feedback.log', module: 'customer-service', description: 'Log customer feedback', roles: [SALES] },
  { code: 'retention-case.manage', module: 'customer-service', description: 'Manage a retention case opened on renewal inactivity/lapse risk', roles: [SALES, MANAGER] },
];

// ----------------------------------------------------------------------
// Domain F — Compliance & Risk (Processes 47-57)
// ----------------------------------------------------------------------
const complianceRisk: PermissionSeed[] = [
  { code: 'aml.monitor', module: 'compliance-risk', description: 'Monitor AML/CFT transaction-monitoring alerts', roles: [COMPLIANCE] },
  { code: 'aml.escalate', module: 'compliance-risk', description: 'Escalate a suspicious-activity alert to the competent authority', roles: [COMPLIANCE] },
  { code: 'sanctions-pep.screen', module: 'compliance-risk', description: 'Run recurring sanctions/PEP screening batches', roles: [COMPLIANCE] },
  { code: 'license.manage', module: 'compliance-risk', description: "Manage the broker's regulatory license record", roles: [COMPLIANCE] },
  { code: 'compliance-calendar.manage', module: 'compliance-risk', description: 'Manage the regulatory compliance calendar', roles: [COMPLIANCE] },
  { code: 'risk-register.manage', module: 'compliance-risk', description: 'Manage the operational/cyber/financial/compliance/reputational risk register', roles: [COMPLIANCE, MANAGER] },
  { code: 'pi-policy.manage', module: 'compliance-risk', description: "Manage the broker's own Professional Indemnity policy record", roles: [COMPLIANCE] },
  { code: 'incident.report', module: 'compliance-risk', description: 'Report a security/privacy incident', roles: [SALES, PLACEMENT, CLAIMS, FINANCE, COMPLIANCE, MANAGER, ADMIN, DPO] },
  { code: 'incident.contain', module: 'compliance-risk', description: 'Execute incident containment actions', roles: [ADMIN, COMPLIANCE] },
  { code: 'incident.classify', module: 'compliance-risk', description: 'Classify an incident as Material (requires DPO + Senior Management co-sign)', roles: [DPO, EXEC] },
  { code: 'incident.notify-regulator', module: 'compliance-risk', description: 'Send a multi-regulator incident notification (CBJ / NCSC / PDPC)', roles: [DPO, COMPLIANCE] },
  { code: 'internal-audit.record', module: 'compliance-risk', description: 'Record an internal audit finding', roles: [COMPLIANCE] },
  { code: 'internal-audit.close', module: 'compliance-risk', description: 'Close an internal audit finding after remediation', roles: [COMPLIANCE, MANAGER] },
  { code: 'audit-log.read', module: 'compliance-risk', description: 'Read the immutable audit log', roles: [COMPLIANCE, ADMIN, AUDITOR] },
  { code: 'document-history.read', module: 'compliance-risk', description: 'Read document version/workflow history', roles: [COMPLIANCE, AUDITOR] },
  { code: 'workflow-history.read', module: 'compliance-risk', description: 'Read workflow-state transition history for a record', roles: [COMPLIANCE, AUDITOR] },
];

// ----------------------------------------------------------------------
// Domain G — Management (Processes 58-65)
// ----------------------------------------------------------------------
const management: PermissionSeed[] = [
  { code: 'dashboard.sales.view', module: 'management-reporting', description: 'View the Sales KPI dashboard', roles: [SALES, MANAGER, EXEC] },
  { code: 'dashboard.policy.view', module: 'management-reporting', description: 'View the Policy dashboard', roles: [PLACEMENT, POLICY_CHECK, MANAGER, EXEC] },
  { code: 'dashboard.claims.view', module: 'management-reporting', description: 'View the Claims dashboard', roles: [CLAIMS, MANAGER, EXEC] },
  { code: 'dashboard.financial.view', module: 'management-reporting', description: 'View the Financial dashboard', roles: [FINANCE, MANAGER, EXEC] },
  { code: 'dashboard.compliance.view', module: 'management-reporting', description: 'View the Compliance dashboard', roles: [COMPLIANCE, DPO, MANAGER, EXEC] },
  { code: 'insurer-performance.view', module: 'management-reporting', description: 'View insurer performance scores', roles: [MANAGER, EXEC] },
  { code: 'employee-performance.view', module: 'management-reporting', description: 'View employee performance KPIs', roles: [MANAGER, EXEC] },
  { code: 'dashboard.executive.view', module: 'management-reporting', description: 'View the executive management dashboard', roles: [EXEC, MANAGER] },
  { code: 'portfolio-analysis.view', module: 'management-reporting', description: 'View portfolio analysis by line/insurer/segment/geography', roles: [MANAGER, EXEC] },
  { code: 'profitability-analysis.view', module: 'management-reporting', description: 'View profitability analysis (commission income vs. cost-to-serve)', roles: [EXEC, FINANCE] },
  { code: 'planning-export.generate', module: 'management-reporting', description: 'Export portfolio/market data for strategic planning', roles: [EXEC] },
];

// ----------------------------------------------------------------------
// Domain H — Supporting Operations (Processes 66-74)
// ----------------------------------------------------------------------
const supportingOperations: PermissionSeed[] = [
  { code: 'employee.manage', module: 'supporting-operations', description: 'Manage an employee record and licensing/certification tracking', roles: [ADMIN, MANAGER] },
  { code: 'training.record', module: 'supporting-operations', description: 'Record security-awareness training completion', roles: [ADMIN, MANAGER] },
  { code: 'deprovisioning.execute', module: 'supporting-operations', description: 'Execute the access de-provisioning checklist on an employment-status change', roles: [ADMIN] },
  { code: 'vendor.manage', module: 'supporting-operations', description: 'Manage a vendor record and its risk tier', roles: [COMPLIANCE, MANAGER, ADMIN] },
  { code: 'dpa.approve', module: 'supporting-operations', description: 'Give High-tier DPO approval on a Data Processing Agreement', roles: [DPO] },
  { code: 'bcp-dr.manage', module: 'supporting-operations', description: 'Manage Business Continuity / Disaster Recovery plans', roles: [ADMIN, COMPLIANCE] },
  { code: 'kb.publish', module: 'supporting-operations', description: 'Publish a knowledge-base article', roles: [COMPLIANCE, MANAGER, PLACEMENT] },
  { code: 'document.manage', module: 'supporting-operations', description: 'Upload/version a document', roles: [SALES, PLACEMENT, CLAIMS, FINANCE, COMPLIANCE] },
  { code: 'document.delete-override', module: 'supporting-operations', description: 'Logged privileged override to delete a document (deletion is disabled by default)', roles: [ADMIN, DPO] },
];

// ----------------------------------------------------------------------
// Part D — Personal Data Protection / PDPL (M-series)
// ----------------------------------------------------------------------
const pdpl: PermissionSeed[] = [
  { code: 'consent.manage', module: 'pdpl', description: 'Capture/withdraw consent at a defined touchpoint', roles: [SALES, PLACEMENT, CLAIMS, DPO] },
  { code: 'dsr.log', module: 'pdpl', description: 'Log a Data Subject Request the same business day it is received', roles: [SALES, FINANCE, CLAIMS, COMPLIANCE, DPO] },
  { code: 'dsr.handle', module: 'pdpl', description: 'Work a DSR as its assigned DPO handler', roles: [DPO] },
  { code: 'dsr.close', module: 'pdpl', description: 'Close a Data Subject Request (never closeable while a retention flag is open)', roles: [DPO] },
  { code: 'retention.dispose.nominate', module: 'pdpl', description: 'Nominate a disposal batch (maker side of dual control)', roles: [MANAGER] },
  { code: 'retention.dispose.approve', module: 'pdpl', description: 'Give final DPO approval on a disposal batch (checker side of dual control)', roles: [DPO] },
  { code: 'legal-hold.manage', module: 'pdpl', description: 'Place/review a Legal Hold', roles: [DPO] },
  { code: 'cross-border-transfer.approve', module: 'pdpl', description: 'Approve a cross-border personal-data transfer', roles: [DPO] },
  { code: 'data-sharing.request', module: 'pdpl', description: 'Request a one-off data share with a third party', roles: [SALES, PLACEMENT, CLAIMS, FINANCE, COMPLIANCE] },
  { code: 'data-sharing.approve', module: 'pdpl', description: 'Approve a third-party data-sharing request', roles: [DPO] },
  { code: 'dpia.review', module: 'pdpl', description: 'Review a DPIA screening result / escalate to a Full DPIA', roles: [DPO] },
  { code: 'privacy-notice.publish', module: 'pdpl', description: 'Publish a version-controlled bilingual privacy notice', roles: [DPO, COMPLIANCE] },
  { code: 'ropa.manage', module: 'pdpl', description: 'Maintain the Records of Processing Activities register', roles: [DPO] },
];

// ----------------------------------------------------------------------
// Admin / RBAC surface (this task)
// ----------------------------------------------------------------------
const admin: PermissionSeed[] = [
  { code: 'role.manage', module: 'admin', description: 'View the role catalogue', roles: [ADMIN] },
  { code: 'permission.manage', module: 'admin', description: 'View the permission grid', roles: [ADMIN] },
  { code: 'user.manage', module: 'admin', description: 'Provision/deprovision user accounts and role assignments', roles: [ADMIN] },
  { code: 'security-config.read', module: 'admin', description: 'Read the security configuration (idle timeout, lockout policy, ...)', roles: [ADMIN] },
  { code: 'security-config.manage', module: 'admin', description: 'Update the security configuration', roles: [ADMIN] },
  { code: 'access-recertification.cycle.start', module: 'admin', description: 'Start an access-recertification cycle', roles: [ADMIN, COMPLIANCE] },
  { code: 'access-recertification.review', module: 'admin', description: "Review and decide an access-recertification item (never one's own)", roles: [MANAGER, COMPLIANCE, EXEC] },
  { code: 'encryption-key.read', module: 'admin', description: 'View encryption key metadata (key id, purpose, active/retired status) — never key material (Part 10.2 key-custodian access)', roles: [ADMIN] },
];

export const PERMISSIONS: PermissionSeed[] = [
  ...commercialFrontOffice,
  ...insuranceOperations,
  ...claims,
  ...finance,
  ...customerService,
  ...complianceRisk,
  ...management,
  ...supportingOperations,
  ...pdpl,
  ...admin,
];
