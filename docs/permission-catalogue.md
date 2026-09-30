# Permission catalogue — دليل الصلاحيات

> **219 permission codes across 12 modules.** Generated from the seeded database by `npx tsx scripts/export-permission-catalogue.ts`, so this is what the Role screen actually renders — not a separate list that can drift from it.
>
> **The English text is the stored description.** It is developer-facing and often terse: a hint at what the code gates, not something to translate word for word.
>
> **"Held by" is the SEEDED roles.** An office defines its own roles under its own names, so these are the eleven the system ships with plus `OFFICE_ADMINISTRATOR` — a starting grid, not a fixed vocabulary. A code held by one role is described differently from one held by ten, which is why this column is here.
>
> **A code held by NO role is not a mistake.** It means the seeded grid grants it to nobody yet; an office can still grant it from the Role screen.

## admin — الإدارة والأمن  (21)

| Code | English description (stored) | Held by |
|---|---|---|
| `access-recertification.cycle.start` | Start an access-recertification cycle | COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `access-recertification.review` | Review and decide an access-recertification item (never one's own) | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT |
| `access-recertification.review.routine` | Be assigned access-recertification items routinely, ahead of fallback reviewers — the assignment preference, not the right to decide (that is access-recertification.review) | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `branch.create` | Create a branch in this office | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `branch.deactivate` | Retire a branch so it is no longer offered for new people (existing records keep it) | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `branch.read` | View the office's branches | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `branch.update` | Rename a branch | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `department.create` | Create a department in this office | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `department.deactivate` | Retire a department so it is no longer offered for new people (existing records keep it) | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `department.read` | View the office's departments | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `department.update` | Rename a department | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `diagnostics.view` | See raw technical detail when something fails — the server's own error text, meant for whoever maintains the system rather than for the person doing the work. Nothing is hidden from the audit trail by withholding this; it only decides whether a screen shows the underlying message or a plain sentence | SYSTEM_SECURITY_ADMINISTRATOR |
| `encryption-key.read` | View encryption key metadata (key id, purpose, active/retired status) — never key material (Part 10.2 key-custodian access) | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `permission.read` | View the global permission catalogue (the codes a role can be granted) | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `role.create` | Define a new role in this office's catalogue | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `role.deactivate` | Retire a role, reactivate a retired one, and delete one that was never used | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `role.read` | View the office's role catalogue | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `role.update` | Rename a role, change what it grants, and set its MFA attributes (behind a step-up challenge) | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `security-config.manage` | Update the security configuration | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `security-config.read` | Read the security configuration (idle timeout, lockout policy, ...) | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `user.manage` | Provision/deprovision user accounts and role assignments | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |

## claims — المطالبات  (13)

| Code | English description (stored) | Held by |
|---|---|---|
| `claim.all-owners.read` | See any Claim regardless of who owns its Customer — the Claims Officer works the whole claims book | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, EXECUTIVE_MANAGEMENT |
| `claim.assess` | Track claim survey/investigation and log status changes | CLAIMS_OFFICER |
| `claim.close` | Close a claim after the client's receipt of payment is confirmed | CLAIMS_OFFICER |
| `claim.delete` | NOT YET ENFORCED — no route deletes a claim, and there is no privileged-override path. To withdraw a claim raised in error use claim.discard, which keeps the record | SYSTEM_SECURITY_ADMINISTRATOR |
| `claim.discard` | Mark a claim notified in error as discarded, before it is registered with the insurer — terminal, with a mandatory reason | CLAIMS_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `claim.document` | Attach mandatory claim documentation | CLAIMS_OFFICER |
| `claim.followup.manage` | Manage claim follow-up alerts | CLAIMS_OFFICER |
| `claim.notify` | Record a claim notification (loss date/location/cause/estimate) | CLAIMS_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `claim.read` | List/read claims, their status-history trail and the coverage schedule in force at the loss date | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, EXECUTIVE_MANAGEMENT, SALES_RELATIONSHIP_OFFICER |
| `claim.register` | Register a claim with the insurer and assign the adjuster | CLAIMS_OFFICER |
| `claim.settle.approve` | Approve a claim settlement (first approver) | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER |
| `claim.settle.second-approve` | Second-approve a large claim settlement or any broker-processed claim payment (never the same person as the first approver) | BRANCH_DEPARTMENT_MANAGER, FINANCE_COLLECTIONS_OFFICER |
| `claims-analytics.view` | View Loss Ratio and claims analytics | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR |

## commercial-front-office — المكتب الأمامي التجاري  (34)

| Code | English description (stored) | Held by |
|---|---|---|
| `cross-sell.convert` | Convert or dismiss a system-flagged cross-sell opportunity | SALES_RELATIONSHIP_OFFICER |
| `cross-sell.detect` | Run an on-demand cross-sell gap scan for a customer | BRANCH_DEPARTMENT_MANAGER, SALES_RELATIONSHIP_OFFICER |
| `cross-sell.read` | List/read cross-sell opportunities | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, SALES_RELATIONSHIP_OFFICER |
| `customer-file.all-owners.read` | See any customer's COMMERCIAL file — risk profile, needs assessment, insurance program, opportunity, RFQ, quotation, comparison, client decision — regardless of owner | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER |
| `customer.360-view.read` | Read the aggregated 360° customer view | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, SALES_RELATIONSHIP_OFFICER |
| `customer.create` | Create a Customer (individual/corporate) | SALES_RELATIONSHIP_OFFICER |
| `customer.read` | List customers and read a customer's basic identity — the path for finding a customer. Does NOT cover the aggregated 360° view, the UBO register, the document list or revealing a masked field, all of which stay under customer.360-view.read | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, FINANCE_COLLECTIONS_OFFICER, OFFICE_ADMINISTRATOR, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER, SYSTEM_SECURITY_ADMINISTRATOR |
| `customer.update` | Correct a customer's contact details — phone, email and registered address. Does NOT cover name, date of birth, nationality or identity numbers: changing one of those is a screening event under the AMLU rules, not an edit | SALES_RELATIONSHIP_OFFICER |
| `interaction.log` | Log a customer interaction (meeting/call/email/...) | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, COMPLIANCE_OFFICER, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `kyc.approve` | Approve a KYC file and activate the Customer (maker/checker: capturer != approver) | COMPLIANCE_OFFICER |
| `kyc.capture` | Capture KYC data and supporting documents | SALES_RELATIONSHIP_OFFICER |
| `kyc.edd.trigger` | Trigger the enhanced due-diligence path on a high-risk result | COMPLIANCE_OFFICER |
| `kyc.review.schedule` | Schedule periodic re-KYC by risk classification | COMPLIANCE_OFFICER |
| `lead.all-owners.read` | See leads and prospects owned by another Sales/Relationship Officer — the org-wide pipeline view, not one's own | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `lead.create` | Create a Lead | SALES_RELATIONSHIP_OFFICER |
| `lead.list.read` | List/filter leads | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, SALES_RELATIONSHIP_OFFICER |
| `lead.transition` | Transition LeadStatus | SALES_RELATIONSHIP_OFFICER |
| `needs-assessment.approve` | Review and approve a Needs Assessment before linking to an Opportunity/RFQ | BRANCH_DEPARTMENT_MANAGER |
| `needs-assessment.create` | Capture a Needs Assessment questionnaire | SALES_RELATIONSHIP_OFFICER |
| `needs-assessment.read` | List/read Needs Assessments | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `needs-assessment.update` | Correct a needs assessment before it is submitted | SALES_RELATIONSHIP_OFFICER |
| `program.assemble` | Assemble a multi-line Insurance Program from risk-assessment results | PLACEMENT_TECHNICAL_OFFICER |
| `program.read` | List/read Insurance Programs | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `prospect.capture` | Convert/qualify a Lead into a Prospect | SALES_RELATIONSHIP_OFFICER |
| `prospect.read` | List/read Prospect profiles | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, SALES_RELATIONSHIP_OFFICER |
| `recommendation.all-owners.read` | See any broker Recommendation regardless of owner — Compliance must reach any of them to clear a conflict-of-interest disclosure the conflicted officer cannot self-clear | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER |
| `risk-profile.create` | Capture a detailed risk survey (Risk Profile/Asset) | PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `risk-profile.read` | List/read Risk Profiles | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `risk-profile.update` | Add, correct and remove the insured assets on a risk profile | PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `screening.run` | Run sanctions/AML screening | COMPLIANCE_OFFICER |
| `ubo.record` | Record Ultimate Beneficial Owners for a corporate customer | COMPLIANCE_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `up-sell.convert` | Convert or dismiss a system-flagged up-sell recommendation | SALES_RELATIONSHIP_OFFICER |
| `up-sell.detect` | Run an on-demand under-insurance scan for a customer | BRANCH_DEPARTMENT_MANAGER, SALES_RELATIONSHIP_OFFICER |
| `up-sell.read` | List/read up-sell recommendations | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, SALES_RELATIONSHIP_OFFICER |

## compliance-risk — الالتزام والمخاطر  (20)

| Code | English description (stored) | Held by |
|---|---|---|
| `aml.escalate` | Escalate a suspicious-activity alert to the competent authority | COMPLIANCE_OFFICER |
| `aml.monitor` | Monitor AML/CFT transaction-monitoring alerts | COMPLIANCE_OFFICER |
| `audit-log.read` | Read the immutable audit log | COMPLIANCE_OFFICER, EXTERNAL_AUDITOR, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `compliance-calendar.manage` | Manage the regulatory compliance calendar | COMPLIANCE_OFFICER |
| `document-history.read` | Read document version/workflow history | COMPLIANCE_OFFICER, EXTERNAL_AUDITOR |
| `duty-segregation.mode.declare` | Declare whether this office separates the two halves of a maker/checker pair, with a recorded reason | OFFICE_ADMINISTRATOR |
| `incident.classification.co-sign` | Co-sign a Material incident classification as Senior Management — the independent second actor, never the one who classified it | EXECUTIVE_MANAGEMENT |
| `incident.classify` | Classify an incident as Material or Non-Material (the DPO half of the pair; the co-sign is a separate permission) | DATA_PROTECTION_OFFICER |
| `incident.contain` | Execute incident containment actions | COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `incident.notify-regulator` | Send a multi-regulator incident notification (CBJ / NCSC / PDPC) | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |
| `incident.report` | Report a security/privacy incident | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER, FINANCE_COLLECTIONS_OFFICER, OFFICE_ADMINISTRATOR, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER, SYSTEM_SECURITY_ADMINISTRATOR |
| `incident.senior-management.notify` | Record that Senior Management was notified of a Material incident (a manual stamp, not part of the classify/co-sign pair) | DATA_PROTECTION_OFFICER, EXECUTIVE_MANAGEMENT |
| `internal-audit.close` | Close an internal audit finding after remediation | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `internal-audit.record` | Record an internal audit finding | COMPLIANCE_OFFICER |
| `internal-controls.view` | View the periodic self-approval (maker/checker) audit report | COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR |
| `license.manage` | Manage the broker's regulatory license record | COMPLIANCE_OFFICER |
| `pi-policy.manage` | Manage the broker's own Professional Indemnity policy record | COMPLIANCE_OFFICER |
| `risk-register.manage` | Manage the operational/cyber/financial/compliance/reputational risk register | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `sanctions-pep.screen` | Run recurring sanctions screening batches | COMPLIANCE_OFFICER |
| `workflow-history.read` | Read workflow-state transition history for a record | COMPLIANCE_OFFICER, EXTERNAL_AUDITOR |

## customer — العملاء  (3)

| Code | English description (stored) | Held by |
|---|---|---|
| `customer.all-owners.read` | See any Customer file regardless of which Sales/Relationship Officer owns it (Compliance needs it for KYC; the External Auditor reads across the org by design) | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR |
| `customer.bulk-import` | Load an office legacy customer file (Part III §7) — a bulk write path, distinct from creating one customer | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `customer.national-id.reveal` | Reveal a customer's unmasked national ID with a written justification (Part 10.2 Highly Confidential; the contact fields on the same endpoint stay under customer.360-view.read) | COMPLIANCE_OFFICER |

## customer-service — خدمة العملاء  (8)

| Code | English description (stored) | Held by |
|---|---|---|
| `communication.send` | Send a logged customer communication (channel/consent-checked) | CLAIMS_OFFICER, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `complaint.close` | Close a complaint (mandatory supervisor sign-off) | BRANCH_DEPARTMENT_MANAGER |
| `complaint.escalate` | Escalate a complaint to the Insurance Dispute Resolution Committee | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `complaint.log` | Log a complaint | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, COMPLIANCE_OFFICER, FINANCE_COLLECTIONS_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `feedback.log` | Log customer feedback | SALES_RELATIONSHIP_OFFICER |
| `retention-case.manage` | Manage a retention case opened on renewal inactivity/lapse risk | BRANCH_DEPARTMENT_MANAGER, SALES_RELATIONSHIP_OFFICER |
| `service-request.manage` | Handle a customer service request (certificate/copy/change) | BRANCH_DEPARTMENT_MANAGER, SALES_RELATIONSHIP_OFFICER |
| `sla-dashboard.view` | Monitor the SLA dashboard across modules | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR |

## finance — المالية  (16)

| Code | English description (stored) | Held by |
|---|---|---|
| `client-accounting.read` | View the client accounts-receivable/ageing report | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, FINANCE_COLLECTIONS_OFFICER |
| `commission-override.approve` | Approve a manual commission override (separately logged from the raiser) | BRANCH_DEPARTMENT_MANAGER |
| `commission-override.raise` | Raise a manual commission override with a mandatory reason | FINANCE_COLLECTIONS_OFFICER |
| `commission-rate.manage` | Alter a commission rate agreement/table (Finance may never do this without approval) | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `commission.calculate` | Apply the governed commission rate from the agreement table | FINANCE_COLLECTIONS_OFFICER |
| `commission.reconcile` | Reconcile a commission ledger entry against the insurer statement and mark it paid | FINANCE_COLLECTIONS_OFFICER |
| `financial-report.view` | View financial reporting/dashboards | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, FINANCE_COLLECTIONS_OFFICER |
| `insurer-accounting.read` | View insurer accounts-payable/remittance obligations | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, FINANCE_COLLECTIONS_OFFICER |
| `invoice.create` | Raise a premium invoice | FINANCE_COLLECTIONS_OFFICER |
| `payment-channel.create` | Add a payment channel to the approved list for a customer or insurer | FINANCE_COLLECTIONS_OFFICER |
| `payment-channel.deactivate` | Disable an approved payment channel so no further money is sent to it | FINANCE_COLLECTIONS_OFFICER |
| `payment-channel.read` | List the approved payment channels for a customer or insurer, as needed when recording a receipt or a remittance | FINANCE_COLLECTIONS_OFFICER |
| `receipt.record` | Record a collection receipt | FINANCE_COLLECTIONS_OFFICER |
| `reconciliation-exception.investigate` | Investigate a bank-reconciliation variance exception | FINANCE_COLLECTIONS_OFFICER |
| `reconciliation-exception.resolve` | Close a reconciliation exception | BRANCH_DEPARTMENT_MANAGER, FINANCE_COLLECTIONS_OFFICER |
| `remittance.record` | Record a remittance to an insurer | FINANCE_COLLECTIONS_OFFICER |

## insurance-operations — العمليات التأمينية  (51)

| Code | English description (stored) | Held by |
|---|---|---|
| `cancellation.create` | Raise a cancellation request (short-period/pro-rata) | PLACEMENT_TECHNICAL_OFFICER |
| `client-decision.capture` | Capture the client's single decision on a sent recommendation (Process 17) — routes the Opportunity to placement / close / renewed negotiation | PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `client-decision.read` | List/read the client decision and its routing outcome | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `commission-reversal.create` | NOT YET ENFORCED — a commission reversal is recorded in the same transaction as its refund, under endorsement.apply. Granting or withdrawing this changes nothing today | FINANCE_COLLECTIONS_OFFICER |
| `comparison.build` | Build/rebuild the quote comparison matrix from the current-version quotations | PLACEMENT_TECHNICAL_OFFICER |
| `comparison.read` | List/read the quote comparison matrix | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `conflict-of-interest.disclose` | Record the mandatory conflict-of-interest disclosure for a flagged recommendation before it can be sent (Process 16). The acknowledger must differ from the drafter (assertDifferentActors). | COMPLIANCE_OFFICER, PLACEMENT_TECHNICAL_OFFICER |
| `email.integration.manage` | Connect, test or disconnect this office's own outbound mailbox (Part I §6). Holds the OAuth consent that lets the platform send as a real company address, so it is administrator-only. | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `email.integration.read` | See which mailbox this office sends from and whether it is working (Part I §6). Never exposes the stored credential. | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `endorsement.all-owners.read` | See any Endorsement regardless of owner (Finance handles the premium adjustment an endorsement produces) | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER |
| `endorsement.apply` | Advance a confirmed endorsement through the financial-adjustment / apply steps and version the policy schedule | PLACEMENT_TECHNICAL_OFFICER |
| `endorsement.create` | Request a positive/negative endorsement | PLACEMENT_TECHNICAL_OFFICER |
| `endorsement.discard` | Mark an endorsement raised in error as discarded, before it is applied — terminal, with a mandatory reason | PLACEMENT_TECHNICAL_OFFICER |
| `endorsement.read` | List/read endorsements, their premium adjustment, the tied commission reversal, the refund approval state and the versioned coverage schedule | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `insurance-line.create` | Add a line of business to this office's vocabulary | OFFICE_ADMINISTRATOR |
| `insurance-line.update` | Correct a line of business this office added | OFFICE_ADMINISTRATOR |
| `insurer.create` | Register an insurer for this office, whether it is in the global catalogue or in none | OFFICE_ADMINISTRATOR |
| `insurer.deactivate` | Stop and resume dealing with an insurer, and read the live impact of doing so | OFFICE_ADMINISTRATOR |
| `insurer.directory.read` | Search the cross-office insurer directory — companies any office has registered, with their public contact details and the lines they offer. Never shows which offices deal with a company, or any office's commercial terms. | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, OFFICE_ADMINISTRATOR, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `insurer.form.map` | Map an insurer's official submission form for one product line (Part I §5). Platform-wide in effect: the mapping becomes the form every other office submits against, which is why it is not granted to the roles that merely consume it. | PLACEMENT_TECHNICAL_OFFICER, SYSTEM_SECURITY_ADMINISTRATOR |
| `insurer.master.read` | Read the GLOBAL insurer master registry and the form mappings shared across every Organization (Part I §5). Carries no per-office commercial terms — those are on the tenant-scoped Insurer row. | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `insurer.office-form.map` | Map THIS OFFICE's own copy of an insurer's submission form, for a company it deals with directly (Q9). Office-scoped in effect: the mapping is readable only by this office, takes precedence over the shared mapping for this office's own submissions, and never alters the shared one. Unlike insurer.form.map it may point at a line this office added itself. | OFFICE_ADMINISTRATOR, PLACEMENT_TECHNICAL_OFFICER, SYSTEM_SECURITY_ADMINISTRATOR |
| `insurer.read` | Read this office's own insurer relationships — contacts, credit terms, financial strength and the lines they offer | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR, OFFICE_ADMINISTRATOR, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `insurer.update` | Maintain this office's own record of an insurer and its relationship terms | OFFICE_ADMINISTRATOR |
| `opportunity.create` | Create an Opportunity from a finalized Insurance Program | PLACEMENT_TECHNICAL_OFFICER |
| `opportunity.read` | List/read Opportunities | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `opportunity.set-target-threshold` | Set/clear the Opportunity's configurable premium threshold that triggers senior-officer approval of the recommendation (Process 16) | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `policy.all-owners.read` | See any Policy regardless of who owns its Customer (the Policy Checking Officer's Process 20 quality control is a cross-book control function) | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, POLICY_CHECKING_OFFICER |
| `policy.check` | Independently check an issued policy against requested coverage line-by-line (maker/checker: never the officer who placed it) — a discrepancy blocks Delivery and auto-logs a PI risk event | POLICY_CHECKING_OFFICER |
| `policy.create` | Create a Policy from an accepted Opportunity | PLACEMENT_TECHNICAL_OFFICER |
| `policy.deliver` | Record policy delivery date/method/recipient/acknowledgement | PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `policy.discard` | Mark a policy raised in error as discarded, before it is issued — terminal, with a mandatory reason | PLACEMENT_TECHNICAL_OFFICER |
| `policy.issue` | Record the insurer-issued policy/schedule/certificates/invoice | PLACEMENT_TECHNICAL_OFFICER |
| `policy.read` | List/read policies, their coverage schedules, electronic-file documents and the quality-control check result | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, POLICY_CHECKING_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `quotation.capture` | Capture an insurer's quotation | PLACEMENT_TECHNICAL_OFFICER |
| `quotation.negotiate` | Record a negotiation round as a new quotation version (the prior version is never deleted or replaced — Process 15) | PLACEMENT_TECHNICAL_OFFICER |
| `quotation.read` | List/read insurer quotations and their version history | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `recommendation.approve` | Approve a recommendation above the configurable premium threshold before it is sent to the client (maker/checker: never the drafter) | BRANCH_DEPARTMENT_MANAGER |
| `recommendation.discard` | Mark a recommendation drafted in error as discarded, before it is sent to the client — terminal, with a mandatory reason | PLACEMENT_TECHNICAL_OFFICER |
| `recommendation.draft` | Draft the broker recommendation with documented rationale (all six factors: coverage/price/financial strength/claims service/deductible/policy conditions) | PLACEMENT_TECHNICAL_OFFICER |
| `recommendation.read` | List/read broker recommendations and their approval / conflict-of-interest state | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `recommendation.send` | Send an approved / cleared recommendation to the client | PLACEMENT_TECHNICAL_OFFICER |
| `refund.approve` | Approve a refund at or above the configurable value threshold (maker/checker: never the raiser) | BRANCH_DEPARTMENT_MANAGER, FINANCE_COLLECTIONS_OFFICER |
| `refund.disburse` | Disburse an approved refund (stamp paidAt and book the client-funds out movement) | FINANCE_COLLECTIONS_OFFICER |
| `refund.raise` | NOT YET ENFORCED — reserved for a standalone refund raise (an overpayment not tied to an endorsement). Granting or withdrawing this changes nothing today: an endorsement-driven refund is raised under endorsement.apply | FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER |
| `renewal.manage` | Run the renewal lead-time sweep, walk a renewal case through RenewalStatus, and set its re-marketing triggers | BRANCH_DEPARTMENT_MANAGER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `renewal.read` | List/read renewal cases, their lead-time window and loss ratio | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `rfq.communication.log` | Record an inbound insurer query or an outbound response / additional-information note on an RFQ (Process 12). Reading the correspondence is covered by rfq.read. | PLACEMENT_TECHNICAL_OFFICER |
| `rfq.create` | Create an RFQ and select an insurer shortlist | PLACEMENT_TECHNICAL_OFFICER |
| `rfq.insurer.update` | Update an insurer's RFQ response status | PLACEMENT_TECHNICAL_OFFICER |
| `rfq.read` | List/read RFQs and insurer submissions | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |

## management-reporting — التقارير الإدارية  (13)

| Code | English description (stored) | Held by |
|---|---|---|
| `dashboard.claims.view` | View the Claims dashboard | BRANCH_DEPARTMENT_MANAGER, CLAIMS_OFFICER, EXECUTIVE_MANAGEMENT |
| `dashboard.compliance.view` | View the Compliance dashboard | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER, EXECUTIVE_MANAGEMENT |
| `dashboard.executive.view` | View the executive management dashboard | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `dashboard.financial.view` | View the Financial dashboard | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, FINANCE_COLLECTIONS_OFFICER |
| `dashboard.policy.view` | View the Policy dashboard | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, PLACEMENT_TECHNICAL_OFFICER, POLICY_CHECKING_OFFICER |
| `dashboard.sales.view` | View the Sales KPI dashboard | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, SALES_RELATIONSHIP_OFFICER |
| `employee-performance.view` | View employee performance KPIs | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `insurer-performance.view` | View insurer performance scores | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `kpi-dashboard.view` | View the general KPI dashboard across every module | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `planning-export.generate` | Export portfolio/market data for strategic planning | EXECUTIVE_MANAGEMENT |
| `portfolio-analysis.view` | View portfolio analysis by line/insurer/segment/geography | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |
| `profitability-analysis.view` | View profitability analysis (commission income vs. cost-to-serve) | EXECUTIVE_MANAGEMENT, FINANCE_COLLECTIONS_OFFICER |
| `sales-target.manage` | Set and revise sales targets per employee/team | BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT |

## pdpl — حماية البيانات الشخصية  (16)

| Code | English description (stored) | Held by |
|---|---|---|
| `consent.manage` | Capture/withdraw consent at a defined touchpoint | CLAIMS_OFFICER, DATA_PROTECTION_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `cross-border-transfer.approve` | Approve a cross-border personal-data transfer | DATA_PROTECTION_OFFICER |
| `data-sharing.approve` | Approve a third-party data-sharing request | DATA_PROTECTION_OFFICER |
| `data-sharing.request` | Request a one-off data share with a third party | CLAIMS_OFFICER, COMPLIANCE_OFFICER, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `dpia.review` | Review a DPIA screening result / escalate to a Full DPIA | DATA_PROTECTION_OFFICER |
| `dpo-workspace.view` | View the DPO Workspace aggregate screen (consent, DSR, incident, DPIA, Legal Hold, cross-border transfer registers) | DATA_PROTECTION_OFFICER |
| `dsr.close` | Close a Data Subject Request (never closeable while a retention flag is open) | DATA_PROTECTION_OFFICER |
| `dsr.handle` | Work a DSR as its assigned DPO handler | DATA_PROTECTION_OFFICER |
| `dsr.log` | Log a Data Subject Request the same business day it is received | CLAIMS_OFFICER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER, FINANCE_COLLECTIONS_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `legal-hold.manage` | Place/review a Legal Hold | DATA_PROTECTION_OFFICER |
| `privacy-notice.publish` | Publish a version-controlled bilingual privacy notice | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |
| `privacy-notice.read` | Read the privacy notice applicable to a touchpoint (read-only; publishing is a separate permission) | CLAIMS_OFFICER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `retention-schedule.manage` | Maintain the retention-period table (record categories, months, Legal Counsel confirmation) | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |
| `retention.dispose.approve` | Give final DPO approval on a disposal batch (checker side of dual control) | DATA_PROTECTION_OFFICER |
| `retention.dispose.nominate` | Nominate a disposal batch (maker side of dual control) | BRANCH_DEPARTMENT_MANAGER |
| `ropa.manage` | Maintain the Records of Processing Activities register | DATA_PROTECTION_OFFICER |

## sla — مستويات الخدمة  (7)

| Code | English description (stored) | Held by |
|---|---|---|
| `sla.holiday.create` | Add a public holiday to the business-day calendar every SLA deadline is counted against | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT |
| `sla.policy.create` | Create an SLA policy — its duration, calendar and escalation stages | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT |
| `sla.policy.deactivate` | Switch an SLA policy off so it stops applying, and switch a dormant one back on | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT |
| `sla.policy.read` | View configured SLA policies and their source/provenance | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR |
| `sla.policy.regulatory` | Change an SLA policy's source type and regulatory citation — i.e. whether the system claims the deadline is legally required | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |
| `sla.policy.update` | Correct an SLA policy's duration, calendar or escalation stages | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT |
| `sla.timer.pause` | Pause and resume a running SLA clock, with a recorded reason | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |

## supporting-operations — العمليات المساندة  (17)

| Code | English description (stored) | Held by |
|---|---|---|
| `bcp-dr.manage` | Manage Business Continuity / Disaster Recovery plans | COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `deprovisioning.execute` | Execute the access de-provisioning checklist on an employment-status change | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `document.create` | Upload a document and add a new version of one | CLAIMS_OFFICER, COMPLIANCE_OFFICER, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `document.delete-override` | Logged privileged override to delete a document (deletion is disabled by default) | DATA_PROTECTION_OFFICER, SYSTEM_SECURITY_ADMINISTRATOR |
| `document.read` | View the document register, a document, and the classification summary | CLAIMS_OFFICER, COMPLIANCE_OFFICER, FINANCE_COLLECTIONS_OFFICER, PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `dpa.approve` | Give High-tier DPO approval on a Data Processing Agreement | DATA_PROTECTION_OFFICER |
| `employee.create` | Create an employee (HR) record | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `employee.national-id.reveal` | Reveal an employee's unmasked national ID with a written justification (Part 10.2 Highly Confidential; every reveal is an audited sensitive read) | COMPLIANCE_OFFICER |
| `employee.read` | View employee records and their licensing/training history | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `employee.update` | Correct an existing employee record | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `information-asset.manage` | Manage the ISO 27001 information asset inventory | COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `kb.publish` | Publish a knowledge-base article | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, PLACEMENT_TECHNICAL_OFFICER |
| `training.record` | Record security-awareness training completion | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `vendor.create` | Register a vendor | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `vendor.deactivate` | Terminate a vendor and revoke its access | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `vendor.read` | View the vendor register, a vendor's record, and its data-share readiness | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `vendor.update` | Correct a vendor record, set its risk tier, record an annual review, raise and sign a data-processing agreement | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |

---

## Measured, so the numbers are checkable

- **219** codes, **12** modules.
- **0** held by no seeded role; **86** held by exactly one.
- **0** have no stored English description.

Regenerate after any permission change. The sibling file `docs/permission-catalogue-for-descriptions.txt` is the one to TYPE INTO — it carries an `ar:` line per code and is regenerated without destroying what is already written there.
