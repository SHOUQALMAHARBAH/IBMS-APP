# System State Audit — what is actually there

**Written 5 October 2026.** An audit, not a build. Nothing in the product was changed to
produce it; two defects it found are recorded here and left in place.

**Why this document exists.** The owner has finished the broker and client interview
sessions and wants to split the remaining work into modules and finish them one at a
time. That needs a per-item statement of what is finished, what is half-built, and what
has never been started. This is that statement.

---

## 0. How to read this, and what each measurement is worth

### The five states. Every item gets exactly one.

| State | Means |
|---|---|
| `NOT_STARTED` | No model, no route, no screen. |
| `MODEL_ONLY` | A schema model exists. No API route reads or writes it. |
| `ENDPOINT_ONLY` | Routes exist and work over HTTP, but nothing a human can reach by clicking reads them. |
| `SCREEN_EXISTS` | A screen exists and is reachable from navigation by at least one role that actually holds the permission. |
| `WALKABLE` | A human holding one real role can complete the step from start to finish on screen, including the unhappy path. |

`ENDPOINT_ONLY` is its own state because three days ago the durable import report was
reported as something the owner could read. Both endpoints worked. No screen read them.
That gap is still open — § 5.2 below — and this vocabulary is what stops it hiding again.

### What WALKABLE is measured by, and what that does NOT prove

`WALKABLE` here is assigned on four conditions, all mechanical:

1. the screen exists under `apps/web/app/(app)/`;
2. the screen, or an ancestor of it, is a nav destination in
   `apps/web/components/app/destinations.ts` whose gate at least one seeded role satisfies;
3. a Playwright spec in `apps/web/e2e/` navigates to it;
4. it carries a load-error branch, a permission-refusal branch and an empty-state signal,
   per `python scripts/measurements/four-states.py`, or sits in one of that measurement's
   three documented exception classes.

**That is evidence of a drivable screen with an unhappy path. It is not a signed-off
business walkthrough.** It does not prove the step produces the right commercial outcome,
and § 4 contains several cases where a `WALKABLE` row still cannot be used by the role
that is supposed to use it. Where the two disagree, § 4 is the sharper reading.

### Scope of every count in this document

| Measured over | Figure |
|---|---|
| `packages/db/prisma/schema.prisma` | 139 models, 62 enums, 0 declared views, 6,195 lines |
| `apps/api/src/**/*.controller.ts` | 100 controller files, 501 routes |
| `apps/web/app/(app)/**/page.tsx` | 102 screens |
| `apps/web/app/(auth)/**/page.tsx` | 5 screens (`login`, `signup`, `forgot-password`, `reset-password`, `change-password`) |
| `apps/web/components/app/destinations.ts` | 80 distinct nav destinations |
| Seeded permission grid | 219 codes, 502 grants, 12 seeded roles |
| `apps/web/e2e/*.spec.ts` | 112 spec files |
| `apps/api/test/*.e2e-spec.ts` | 110 spec files |
| `packages/db/prisma/migrations/` | 120 migrations |

The permission grid figure is the one number measured **twice from independent sources**:
parsing `packages/db/prisma/seed-data/permissions.ts` (the seed's input) gives 219 codes /
502 grants / 12 roles, and parsing `apps/web/e2e/fixtures/role-permissions.ts` (generated
*from the seeded database*) gives the same 502 and the same per-role split. Both agree
role by role.

### What could not be measured, and why

**Docker was not running on this host during the audit** (`docker ps` →
`failed to connect to the docker API ... dockerDesktopLinuxEngine`). So **no live row
count was taken.** Every question of the form "is this table empty?" is answered from the
seed and migration source and is labelled as such. Specifically unmeasured:

- the live contents of `RetentionScheduleItem`, `SlaHoliday`, `SlaTimer`, `Policy`;
- whether office B has any `Branch` rows (§ 5.5);
- whether `sample.compliance` and `sample.manager` can sign in (§ 5.6).

Three further things are not claimed:

- **Rule 6 of the bilingual sweep has a known detector ceiling** — § 3.F states it.
- **`scripts/measurements/permission-reachability.py` could not be run.** It asserts
  `sum(len(v) for v in out.values()) == 491` at line 56 and today's grid holds 502, so it
  exits on its own non-vacuity pin. That is a stale pin, not a product defect; the same
  measurement was re-done for this audit with the pin corrected to the measured 502.
- **No test suite was executed.** This audit reads source, schema, migrations and the
  generated fixtures. It does not report pass counts.

---

# PART ONE — The 74 processes

Rows follow PART C of `ibms-system-full-task-backlog-en.md` in its own order and
numbering. **70 rows cover 74 numbered processes**, because the backlog itself groups
four pairs: #3–4, #18–19, #53–54, #72–73.

Every model name, controller path, screen route and permission code in these rows was
verified to exist before being written down: models against `schema.prisma`, controllers
against disk, screens against `app/(app)`, permission codes against the seeded grid. The
first pass of this table named **34 permission codes that do not exist** — all of them my
own guesses at a naming convention — and every one was replaced with the code the
controller actually declares. A row whose entity failed verification was corrected, never
left in.

**"How the rule is enforced"** is the column that matters more than the state. `DB` means a
constraint or trigger in Postgres. `service` means application code only. `UI` means the
screen is the only thing holding it, which is to say it is not held.

## Domain A — Commercial / Front Office (1–10)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 1 | Lead Management | `WALKABLE` | `Lead` · `modules/lead/lead.controller.ts` · `/leads`, `/leads/[id]` · `lead.create` (SALES), `lead.transition` (SALES), `lead.list.read` (SALES, MANAGER, EXEC) | Intake, pipeline, status moves | **DB + service** — `LeadStatus` moves only through `transition()`; a direct status write is refused by a fail-on-any guard | Invalid move → 422 naming the allowed next states; no permission → refusal naming the code |
| 2 | Prospect Management | `WALKABLE` | `Prospect` · `prospect.controller.ts` · `/prospects`, `/prospects/new`, `/prospects/[id]` · `prospect.capture` (SALES), `prospect.read` (SALES, MANAGER, EXEC) | Qualify a lead; capture sector/size/expected premium | service | `/prospects/new` has no empty state — correct, it is a create-only screen |
| 3–4 | Customer Acquisition / Onboarding | `WALKABLE` | `Customer`, `UltimateBeneficialOwner`, `KYCRecord`, `ScreeningResult`, `RiskRating`, `Document` · `customer.controller.ts`, `kyc.controller.ts`, `screening.controller.ts` · `/customers`, `/customers/new`, `/customers/[id]`, `/customers/kyc-queue` · `customer.create` (SALES), `customer.read` (10 roles), `customer.360-view.read` (SALES, MANAGER, EXEC, COMPLIANCE, AUDITOR), `kyc.approve` (COMPLIANCE) | Two intake forms, KYC, UBOs, screening, approval gate | **DB** — `KYCRecord_maker_checker_distinct` refuses capture-and-approve by one person | Self-approval → DB refusal; duplicate name → the officer is asked and the answer is recorded either way (`DuplicateNameWarning`) |
| 5 | Needs Assessment | `WALKABLE` | `NeedsAssessment` · `needs-assessment.controller.ts` · `/needs-assessments`, `/new`, `/[id]` · `needs-assessment.create` (SALES), `.read` (SALES, PLACEMENT, MANAGER, EXEC), `.approve` (MANAGER) | Questionnaire → recommended cover | **DB** — *two* pairs: `NeedsAssessment_reviewer_maker_checker_distinct` and `..._approver_...` | Reject writes no `approvedByUserId`, so that pair's CHECK cannot fire on the reject path — the rule lives in service code alone there |
| 6 | Risk Assessment | `WALKABLE` | `RiskProfile`, `Asset` · `risk-profile.controller.ts` · `/risk-profiles`, `/risk-profiles/[id]` · `risk-profile.create`, `risk-profile.read` | Survey → Sum Insured, indemnity period | service | Detail page answers 404 not 403 by design |
| 7 | Program Design | `WALKABLE` | `InsuranceProgram`, `InsuranceProgramLine` · `insurance-program.controller.ts` · `/insurance-programs`, `/new`, `/[id]` · `program.assemble`, `program.read` | Assemble a multi-line programme | **DB + service** — `InsuranceProgramStatus` through `transition()`; `InsuranceProgramLine_office_line_same_org_fkey` keeps a line in the same office | Composite FK makes a cross-office line unrepresentable |
| 8 | Cross-Selling | `SCREEN_EXISTS` | `CrossSellOpportunity` · `cross-sell.controller.ts` · `/cross-sell`, `/cross-sell/[id]` · `cross-sell.read` | Nightly gap sweep (`@Cron('0 4 * * *')`), convert/dismiss | **DB + service** — `CrossSellStatus` through `transition()` | **`/cross-sell/[id]` is driven by no Playwright spec** — the only reason this is not `WALKABLE` |
| 9 | Up-Selling | `SCREEN_EXISTS` | `UpSellRecommendation` · `up-sell.controller.ts` · `/up-sell`, `/up-sell/[id]` · `up-sell.read` | Sum-Insured-vs-asset-value sweep (`@Cron('0 5 * * *')`) | **DB + service** — `UpSellStatus` through `transition()` | **`/up-sell/[id]` is driven by no Playwright spec** |
| 10 | Relationship Management (CRM) | `WALKABLE` | `Interaction` · `crm.controller.ts` · `/crm` · `interaction.log`, `customer.360-view.read` | Log every touchpoint; 360° timeline | service | A discarded record leaves the timeline and stays in its own register — asserted by test |

## Domain B — Insurance Operations (11–22)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 11 | RFQ / Market Submission | `SCREEN_EXISTS` | `RFQ`, `RFQInsurer` · `rfq.controller.ts`, `rfq-insurer.controller.ts` · `/rfqs`, `/rfqs/new`, `/rfqs/[id]` · `rfq.create`, `rfq.read` | One RFQ per line, insurer shortlist, follow-up sweep (`@Cron('0 6 * * *')`) | **DB** — `@@unique([opportunityId, insuranceLine])` is one RFQ per line per opportunity | **`/rfqs` (the list) is driven by no Playwright spec**; `/rfqs/[id]` is driven by 14 |
| 12 | Market Placement | `WALKABLE` | `RFQInsurer`, `CommunicationLog` · `rfq-insurer.controller.ts` · `/rfqs/[id]` · `rfq.insurer.update` | Per-insurer response status | **DB + service** — `RfqInsurerStatus` through `transition()` | See § 4.2 — nothing happens to the insurers that were **not** chosen |
| 13 | Quotation Management | `WALKABLE` | `Quotation` · `quotation.controller.ts` · `/rfqs/[id]` · `quotation.capture`, `quotation.read` | Capture a quote; version chain | service — `previousVersionId`/`isCurrentVersion` | Zero premium refused: *"premium must be greater than zero — a quotation with no premium is not a quote"* (`quotation.config.ts:113`) |
| 14 | Quote Comparison | `WALKABLE` | `ComparisonMatrix`, `ComparisonMatrixRow` · `comparison.controller.ts` · `/opportunities/[id]` · `comparison.build`, `comparison.read` | Build the matrix from current-version quotes | service | Non-responding insurers flagged in the output |
| 15 | Negotiation | `WALKABLE` | `Quotation` · `quotation.controller.ts` · `/rfqs/[id]` · `quotation.capture` | Each round is a new version | service | A version is never overwritten |
| 16 | Broker Recommendation | `WALKABLE` | `Recommendation`, `ConflictOfInterestDisclosure` · `recommendation.controller.ts` · `/opportunities/[id]` · `recommendation.draft`, `recommendation.approve` | Draft + rationale; approval above threshold; COI detection | **DB** — `Recommendation_maker_checker_distinct` | Drafter cannot approve their own above-threshold recommendation — DB refusal |
| 17 | Client Decision Handling | `WALKABLE` | `ClientDecision` · `client-decision.controller.ts` · `/opportunities/[id]` · `client-decision.capture`, `client-decision.read` | Capture decision type, route onward | service | `GET /client-decisions/:id` has no web caller (redundant read — the list carries the same shape) |
| 18–19 | Policy Placement & Issuance | `WALKABLE` | `Policy`, `PolicySchedule`, `Document` · `policy.controller.ts` · `/policies`, `/policies/[id]`, `/opportunities/[id]` · `policy.create`, `policy.read`, `policy.issue` | Create from opportunity, record insurer-issued policy | **DB** — `Policy_organizationId_policyNumber_key`, `Policy_opportunityId_key`, `Policy_discard_all_or_nothing` | **Zero issued premium is accepted** — only negative is refused (§ 4.11) |
| 20 | Policy Checking (QC) | `WALKABLE` | `PolicyChecking` · `policy.controller.ts` · `/policies/[id]` · `policy.check` | Line-by-line requested vs issued | **DB** — `PolicyChecking_maker_checker_distinct` | Discrepancy → `DISCREPANCY`, Delivery blocked, PI risk event auto-logged |
| 21 | Policy Delivery | `WALKABLE` | `DeliveryRecord` · `policy.controller.ts` · `/policies/[id]` · `policy.deliver` | Date, method, recipient, acknowledgement | service | Blocked while a checking discrepancy stands |
| 22 | Endorsement Management | `WALKABLE` (but see § 4.5) | `Endorsement`, `Cancellation`, `Refund`, `CommissionReversal`, `PolicySchedule` · `endorsement.controller.ts`, `refund.controller.ts` · `/opportunities/[id]` · `endorsement.create`, `endorsement.apply`, `refund.approve` | Adjustment, cancellation, refund, commission reversal | **DB** — `Refund_maker_checker_distinct`; `Endorsement_one_live_cancellation_per_policy` (partial unique, excludes discarded rows) | **`refund.approve`'s holder FINANCE cannot reach `/opportunities/[id]`** — § 4.5 |

## Domain C — Claims (23–30)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 23 | Claim Notification | `WALKABLE` | `Claim` · `claim.controller.ts` · `/claims`, `/claims/[id]` · `claim.notify`, `claim.read` | Loss date/location/cause, third party | **DB + service** — `ClaimStatus` through `transition()`; cover validated at the **loss date** against `PolicySchedule.effectiveFrom/effectiveTo` | `claim.notify` is held by SALES and CLAIMS, who reach it from two different screens (`/opportunities/[id]` and `/policies/[id]`) |
| 24 | Claim Registration | `WALKABLE` | `Claim`, `Adjuster` · `claim.controller.ts` · `/claims/[id]` · `claim.register` | → REGISTERED, assign adjuster | DB + service | Invalid move → 422 naming allowed states |
| 25 | Claim Documentation | `WALKABLE` | `ClaimDocument`, `Document` · `claim.controller.ts` · `/claims/[id]` · `claim.document` | Mandatory checklist per claim type | service | Checklist incomplete → progression refused |
| 26 | Claim Assessment | `WALKABLE` | `Adjuster`, `ClaimStatusHistory` · `claim.controller.ts` · `/claims/[id]` · `claim.assess` | Survey/investigation; every status change recorded | DB + service | Each change gets its own `ClaimStatusHistory` row |
| 27 | Claim Follow-up | `WALKABLE` | `ClaimFollowUpAlert` · `claim.controller.ts` · `/claims/[id]` · `claim.followup.manage` | Nightly insurer-non-response sweep (`@Cron('0 7 * * *')`) | service | § 4.4 — this is the mechanism; there is **no claim status** for "did not answer in time" |
| 28 | Claim Settlement | `WALKABLE` (but see § 4.5) | `Settlement` · `claim.controller.ts` · `/claims/[id]` · `claim.settle.approve`, `claim.settle.second-approve` | Four distinct figures; second approver for large claims | **DB** — `Settlement_maker_checker_distinct` | **`claim.settle.second-approve`'s holder FINANCE cannot reach `/claims/[id]`** — § 4.5 |
| 29 | Claim Closure | `WALKABLE` | `Claim` · `claim.controller.ts` · `/claims/[id]` · `claim.close` | Formal closure; triggers Loss Ratio recompute | DB + service | Cannot close without a recorded settlement amount |
| 30 | Claims Analytics | `WALKABLE` | `LossRatio` · `claims-analytics.controller.ts` · `/claims-analytics` · `claims-analytics.view` | Loss ratio by client/policy/line | service | Discarded claims leave the ageing report |

## Domain D — Finance (31–40)

**Read § 4.5 and § 4.6 before this table.** Every row marked `WALKABLE` here is drivable
by *some* role; six of the eight write operations cannot be reached by the Finance
Officer who holds their permission.

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 31 | Premium Billing | `WALKABLE` (but § 4.5) | `Invoice` · `invoice.controller.ts` · `/policies/[id]` (route) / **rendered on `/opportunities/[id]`** · `invoice.create`, `client-accounting.read` | Premium + tax + fees **less commission** | service — `totalAmount` computed server-side, DTO refuses it | Negative total → 422; rate outside 0..100 → 422. **The client is billed NET of commission** — § 4.6 |
| 32 | Collection | `WALKABLE` (but § 4.5) | `Receipt`, `Remittance` · `invoice.controller.ts` · rendered on `/opportunities/[id]` · `receipt.record`, `remittance.record` | Invoice → receipt → reconcile → remittance; instalments supported | **DB** — `Remittance.receiptId @unique` is one remittance per invoice | **The remittance stored is the NET figure** — § 4.6 |
| 33 | Client Accounting | `WALKABLE` | `Invoice`, `Receipt` · `client-accounting.controller.ts` · `/client-accounting` · `client-accounting.read` | AR / ageing per customer | service | — |
| 34 | Insurer Accounting | `WALKABLE` | `Remittance` · `insurer-accounting.controller.ts` · `/insurer-accounting` · `insurer-accounting.read` | AP / remittance obligations per insurer | service | Figures are net — § 4.6 |
| 35 | Commission Calculation | `WALKABLE` | `CommissionAgreement`, `CommissionLedgerEntry` · `commission.controller.ts` · `/commission` · `commission.calculate`, `commission.reconcile`, `commission-override.approve` | Rate from the agreement table by insurer + line | **DB** — `CommissionLedgerEntry_maker_checker_distinct`; `UNIQUE ... NULLS NOT DISTINCT` on the variant axis | Override needs a reason and a separate approver — DB refusal on self-approval |
| 36 | Commission Reconciliation | `WALKABLE` | `CommissionLedgerEntry` · `commission.controller.ts` · `/commission` · `commission.reconcile` | Rate/amount/tax/paid/outstanding/reversed | service | — |
| 37 | Refund Management | `WALKABLE` (but § 4.5) | `Refund` · `refund.controller.ts` · `/opportunities/[id]` · `refund.approve`, `refund.disburse` | Approve then pay | **DB** — `Refund_maker_checker_distinct` | **Neither holder can reach the screen** — FINANCE holds both codes and no `opportunity.read` |
| 38 | Payment Processing | `WALKABLE` | `Receipt`, `Remittance`, `PaymentChannel` · `payment-channel.controller.ts` · `/payment-channels` · `payment-channel.read`, `payment-channel.create` | Approved channels for customers and insurers | service | Channel types are `bank_transfer`, `cheque`, `card`, `cash` — § 4.12 |
| 39 | Bank Reconciliation | `WALKABLE` | `ReconciliationException` · `reconciliation.controller.ts` · `/bank-reconciliation` · `reconciliation-exception.investigate`, `...resolve` | Variance detection, always raises an exception | service — `computeVariance` never rounds a variance away | A non-zero variance **always** raises an exception; never a silent write-off. The broker's record side of the comparison is the NET figure — § 4.6 |
| 40 | Financial Reporting | `WALKABLE` | `Invoice`, `CommissionLedgerEntry` · `financial-report.controller.ts` · `/financial-report` · `financial-report.view` | Earned, VAT, clawbacks, net, outstanding per insurer | service | The most revealing screen in the system |

## Domain E — Customer Service (41–46)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 41 | Customer Requests | `WALKABLE` | `ServiceRequest`, `SlaTimer` · `service-request.controller.ts` · `/service-requests` · `service-request.manage` | Log and fulfil; SLA tracked (`service_request_fulfilment`) | service | Overdue → escalation sweep every 15 min |
| 42 | Complaints Management | `WALKABLE` | `Complaint`, `ComplaintAction`, `EscalationRecord`, `SlaTimer` · `complaint.controller.ts` · `/complaints` · `complaint.log`, `complaint.escalate`, `complaint.close` | Log, escalate, close | **DB** — `Complaint_closure_maker_checker_distinct` | Whoever resolved it cannot approve its closure — DB refusal |
| 43 | SLA Management | `WALKABLE` | `SlaTimer` · `sla-dashboard.controller.ts` · `/sla-dashboard`, `/sla-policies` · `sla-dashboard.view`, `sla.policy.read` | Monitoring across every module | service | A paused clock reads `paused`, not `breached`; an empty holiday calendar raises an alert, not an empty table |
| 44 | Customer Communication | `WALKABLE` | `CommunicationLog`, `ConsentRecord` · `communication.controller.ts` · `/communications` · `communication.send` | Respect channel + language; check consent before marketing | service | Marketing send refused without granted consent |
| 45 | Customer Feedback | `WALKABLE` | `CustomerFeedback` · `feedback.controller.ts` · `/feedback` · `feedback.log` | Record feedback | service | `GET /feedback/:id` has no web caller (redundant read) |
| 46 | Customer Retention | `WALKABLE` | `RetentionCase` · `retention-case.controller.ts` · `/retention-cases` · `retention-case.manage` | Auto-open on renewal inactivity (`@Cron('0 8 * * *')`) | service | `GET /retention-cases/:id` has no web caller |

## Domain F — Compliance & Risk (47–57)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 47 | KYC | `WALKABLE` | `KYCRecord` · `kyc.controller.ts` · `/customers/kyc-queue` · `kyc.approve`, `kyc.capture`, `kyc.edd.trigger` | Approval gate before a Customer goes ACTIVE | **DB** — `KYCRecord_maker_checker_distinct` | `ScreeningHoldService` gates KYC approval on a current screening |
| 48 | AML/CFT | `WALKABLE` | `ScreeningResult`, `TransactionMonitoringAlert` · `transaction-monitoring.controller.ts` · `/transaction-monitoring` · `aml.monitor` | Unusual-pattern sweep (`@Cron('0 9 * * *')` ) | service | **Pre-transaction screening is not implemented** — README § Known gaps states this as an unmet regulatory obligation |
| 49 | Sanctions & PEP Screening | `WALKABLE` | `ScreeningResult`, `ScreeningMatch` · `screening.controller.ts`, `watchlist-sync.controller.ts` · `/screening-matches`, `/watchlist-sync`, `/screening-health` · `sanctions-pep.screen` | Onboarding + material change + recurring batch | service | Match review: assign → start-review → decide; a generation past retention is listed but refused for rollback |
| 50 | Conflict of Interest | `WALKABLE` | `ConflictOfInterestDisclosure` · `recommendation.controller.ts` · `/opportunities/[id]` · `recommendation.draft` | Auto-detect a higher-commission recommendation; disclosure before send | service | Send blocked until disclosure |
| 51 | Regulatory Compliance (CBJ) | `WALKABLE` | `BrokerLicense`, `ComplianceCalendarItem` · `broker-license.controller.ts`, `compliance-calendar.controller.ts` · `/regulatory-compliance` · `license.manage`, `compliance-calendar.manage` | Licence tracking; calendar with evidence of submission | service | New business blocked once the licence lapses |
| 52 | Data Protection Compliance | `WALKABLE` | `DataSubjectRequest` · `dpo-workspace.controller.ts` · `/dpo-workspace` · `dpo-workspace.view` | All of Part D on one screen | see § 3.D | — |
| 53–54 | Operational & PI Risk | `WALKABLE` | `RiskRegisterItem`, `ProfessionalIndemnityPolicy`, `ProfessionalIndemnityRiskEvent` · `risk-register.controller.ts`, `pi-policy.controller.ts`, `pi-risk-event.controller.ts` · `/operational-pi-risk` · `risk-register.manage`, `pi-policy.manage` | Six-category register; the broker's own PI cover | service | PI renewal is a new row, not an edit |
| 55 | Incident Management | `WALKABLE` (but § 4.5) | `IncidentReport` · `incident.controller.ts` · `/incidents` · `incident.report`, `incident.classify`, `incident.classification.co-sign` | Reported → Contained → Classified → Notified → Recovered → Closed | **DB** — `IncidentReport_classification_maker_checker_distinct`; status through `transition()` | **`incident.classification.co-sign`'s holder EXECUTIVE_MANAGEMENT cannot reach `/incidents`** — § 4.5 |
| 56 | Internal Controls | `WALKABLE` | `CombinedDutyAct` · `internal-controls.controller.ts` · `/internal-controls` · `internal-controls.view` | Declared-combined-duty report + self-approval scan | **DB** — 15 CHECK constraints plus a trigger on `CombinedDutyAct` | Access self-reviews sort above every transaction act and render FLAGGED |
| 57 | Internal Audit | `WALKABLE` | `InternalAuditFinding` · `internal-audit-finding.controller.ts` · `/internal-audit-findings` · `internal-audit.record`, `internal-audit.close` | Findings, remediation, closure | service | EXTERNAL_AUDITOR is read-only **by construction** — proven from the `.read`/`.view` suffix, not an exclusion list |

## Domain G — Management (58–65)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 58 | General KPI dashboard | `WALKABLE` | — · `kpi-dashboard.controller.ts` · `/kpi-dashboard` · `kpi-dashboard.view` | Cross-module aggregates | service | Read is audited (`action: 'READ'`) |
| 59 | Sales Performance | `WALKABLE` | `SalesTarget` · `sales-performance.controller.ts` · `/sales-performance` · `dashboard.sales.view`, `sales-target.manage` | Per employee/team against target | **DB** — two partial unique indexes (not one composite) for NULL-distinctness | `GET /sales-targets/:id` has no web caller |
| 60 | Insurer Performance | `WALKABLE` | `InsurerPerformanceScore` · `insurer-performance.controller.ts` · `/insurer-performance` · `insurer-performance.view` | Monthly score job (`@Cron('0 6 1 * *')`) | service | Scored per insurer on manual trigger, bounded concurrency |
| 61 | Employee Performance | `WALKABLE` | `EmployeePerformanceRecord` · `employee-performance.controller.ts` · `/employee-performance` · `employee-performance.view` | Monthly job (`@Cron('0 7 1 * *')`) | service | Reveals commission **per employee** — a staff-privacy decision |
| 62 | Portfolio Analysis | `WALKABLE` | — · `portfolio-analysis.controller.ts` · `/portfolio-analysis` · `portfolio-analysis.view` | By line/insurer/segment/geography | service | — |
| 63 | Profitability Analysis | `WALKABLE` | — · `profitability-analysis.controller.ts` · `/profitability-analysis` · `profitability-analysis.view` | Commission income vs cost-to-serve | service | EXEC + FINANCE only |
| 64 | Executive Management Reporting | `SCREEN_EXISTS` | — · `executive-dashboard.controller.ts` · `/dashboards/executive` · `dashboard.executive.view` | Executive surface | service | **`/dashboards/executive` is driven by no Playwright spec** |
| 65 | Strategic Planning Inputs | `WALKABLE` | — · `planning-export.controller.ts` · `/planning-export` · `planning-export.generate` | Export portfolio/market data | service | First writer of `AuditAction.EXPORT` |

## Domain H — Supporting Operations (66–74)

| # | Name | State | Evidence | What it does | Rule enforced by | Unhappy path |
|---|---|---|---|---|---|---|
| 66 | Human Resources | `WALKABLE` | `Employee`, `SecurityAwarenessTraining`, `AccessDeprovisioningChecklist` · `employee.controller.ts` · `/employees`, `/employees/[id]`, `/employees/reveal` · `employee.create`, `employee.read` | Person + licensing + training; de-provisioning on status change | service, plus a real access effect (deactivate + kill sessions) | A person and their login are one act, one transaction |
| 67 | Procurement | `WALKABLE` | `Vendor` · `vendor.controller.ts` · `/vendors`, `/vendors/[id]` · `vendor.create`, `vendor.read` | General vendor record (`vendorType=other`) | service | No `PurchaseRequest` model — the backlog says not to invent one |
| 68 | Internal Information Technology | `NOT_STARTED` | — | — | — | **No model, no route, no screen.** The backlog itself says the executable tasks already exist under A.10 and that *"no standalone data table is required by the text"* — so this is `NOT_STARTED` as a Part C process and that is the backlog's own intent, not a gap |
| 69 | Cybersecurity | `WALKABLE` | `InformationAsset` · `information-asset.controller.ts` · `/information-assets` · `information-asset.manage` | Asset register | service | `GET /information-assets/:id` has no web caller |
| 70 | Document Management | `WALKABLE` (but § 4.5) | `Document` · `document.controller.ts` · `/documents` · `document.read`, `document.create`, `document.delete-override` | Versioning, classification, logged deletion override | service — app-level guard because `previousVersionId` is `SET NULL`, not `RESTRICT` | **`document.delete-override`'s holders DPO and SYSTEM_SECURITY_ADMINISTRATOR cannot reach `/documents`** — § 4.5 |
| 71 | Vendor Management | `WALKABLE` (but § 4.5) | `Vendor`, `DataProcessingAgreement` · `vendor.controller.ts`, `data-processing-agreement.controller.ts` · `/vendors`, `/vendors/[id]` · `vendor.read`, `dpa.approve` | Risk tiering, DPA for Medium/High, annual review | **DB** — `DataProcessingAgreement_maker_checker_distinct` | **`dpa.approve`'s holder DPO cannot reach `/vendors`** — § 4.5. `/vendors/[id]` has no empty-state signal |
| 72–73 | Business Continuity & DR | `WALKABLE` | `BcpDrPlan` · `bcp-dr-plan.controller.ts` · `/bcp-dr-plans` · `bcp-dr.manage` | Plans per scenario, RTO/RPO, test dates | service | Deliberately **not** wired into `SLA_REGISTRY` — no sourced test cadence exists |
| 74 | Knowledge Management | `WALKABLE` | `KnowledgeBaseArticle` · `knowledge-base-article.controller.ts` · `/knowledge-base` · `kb.publish` | Bilingual KB | service | Creation **is** publishing. **Three hardcoded Arabic labels on this screen** — § 3.F |

## The count, and its scope

Measured over the 70 rows above, which cover all 74 numbered PART C processes:

| State | Rows | Which |
|---|---|---|
| `NOT_STARTED` | **1** | #68 Internal IT — and the backlog itself says no table is required |
| `MODEL_ONLY` | **0** | — |
| `ENDPOINT_ONLY` | **0** | — at process grain. **Four capabilities *inside* processes are `ENDPOINT_ONLY`** — listed below |
| `SCREEN_EXISTS` | **4** | #8 Cross-Selling, #9 Up-Selling, #11 RFQ, #64 Executive Reporting — each for one reason only: a screen with no Playwright spec |
| `WALKABLE` | **65** | the rest |

**No process was skipped.** All 74 are reached.

### `ENDPOINT_ONLY` capabilities inside otherwise-walkable processes

The state above is assigned at the grain the backlog defines. At finer grain, **21 of the
501 routes have no web caller at all**, measured by two passes
(`scripts/measurements/unreachable-routes.py`, 13 routes; then
`unreachable-routes-by-verb.py`, 8 more that the first pass counts as reachable because a
sibling verb on the same path is called). Four of the 21 are real missing capabilities
rather than redundant reads:

| Capability | Routes | Belongs to |
|---|---|---|
| **The durable import report** | `GET /imports/customers/batches`, `GET /imports/customers/batches/:id` | #3–4 — § 5.2 |
| **An insurer's form template (office copy)** | `GET`/`POST /insurers/:id/form-templates`, `GET /insurers/:id/form-templates/resolved` | § 4.13 |
| **An insurer's form template (global catalogue)** | `GET /insurer-masters/:id`, `GET`/`POST /insurer-masters/:id/form-templates`, `.../current` | § 4.13 |
| **Cross-border transfer detail read** | `GET /cross-border-transfers/:id` | Part D item 4 |

The remaining 17 are detail reads whose list route returns the same shape
(`/client-decisions/:id`, `/feedback/:id`, `/retention-cases/:id`,
`/commission/entries/:id`, `/transaction-monitoring-alerts/:id`,
`/reconciliation-exceptions/:id`, `/sales-targets/:id`, `/retention-schedule/:id`,
`/information-assets/:id`, `/knowledge-base-articles/:id`, `/sla/timers/:id/status`) —
redundant surface, not missing capability.

---

# PART TWO — The cross-cutting machinery

## A.4 Immutable Audit Trail

| Question | Answer | Evidence |
|---|---|---|
| Written from the service layer on every Create/Update/Delete/Approve/Reject/Transition/Export/Print? | **Yes for 10 of 11 verbs; PRINT has no writer** | `AuditAction` declares `CREATE READ UPDATE DELETE DISCARD APPROVE REJECT TRANSITION EXPORT PRINT` plus 10 auth/session verbs, `ENCRYPTION_KEY_USED` and `SLA_ESCALATED`. `AuditService.record`/`recordInTransaction`. `TRANSITION` is written **inside the same `$transaction`** as the status change. **`'PRINT'` is written 0 times in `apps/api/src`** — § 4.17 |
| Is READ access on sensitive data logged, or only writes? | **Logged** | **32 `action: 'READ'` audit writes across 29 non-spec files**; **35 sites set `isSensitiveDataAccess: true`**. Reading the audit log is itself audited — counts only, never a name, so the lookup does not pollute what is being searched |
| Update/Delete on the audit table blocked at the **permission** layer? | **Yes — structurally** | Only one audit permission exists in the 219: `audit-log.read` (COMPLIANCE, SYSTEM_SECURITY_ADMINISTRATOR, EXTERNAL_AUDITOR, OFFICE_ADMINISTRATOR). There is **no update or delete code to grant**, and **0 `auditLogEntry.update`/`.delete` calls** in `apps/api/src` or `packages/db/src`. The audit controller exposes 4 routes, all `GET` |
| …and at the **database** layer? | **Yes — two triggers** | `20260826083942_add_audit_log_entry_immutability_trigger`: `BEFORE UPDATE` and `BEFORE DELETE` on `"AuditLogEntry"`, raising *"AuditLogEntry rows are immutable (Part 10.3) — % is not permitted"*. A later migration (`20261017100000_audit_actor_roles`) **asserts both triggers still exist** and refuses to deploy otherwise. A third migration refuses to deploy if the runtime role is SUPERUSER, because a superuser could disable them via `session_replication_role` |

**One gap named:** `AuditAction.PRINT` exists in the enum and in the web's mirror
(`apps/web/lib/audit-trail/audit-trail-api.ts:31`) and nothing ever writes it — see § 4.17.

## A.5 Maker/Checker — the nine named pairs, pair by pair

**16 `dbCheckConstraint:` lines in `apps/api/src/common/maker-checker-pairs.config.ts`, of
which one is the interface field declaration — so 15 declared pairs. 15 CHECK constraints
named `*maker_checker*` exist in the migrations. The two sets are identical: 0 in config
and not in migrations, 0 in migrations and not in config.**

All nine the backlog names have a DB-level CHECK constraint:

| # | Backlog pair | Maker column | Checker column | DB CHECK constraint |
|---|---|---|---|---|
| 1 | `KYCRecord` | `createdByUserId` | `approvedByUserId` | `KYCRecord_maker_checker_distinct` |
| 2 | `PolicyChecking` | `placedByUserId` | `checkedByUserId` | `PolicyChecking_maker_checker_distinct` |
| 3 | `Refund` | `raisedByUserId` | `approvedByUserId` | `Refund_maker_checker_distinct` |
| 4 | `DisposalBatch` | `nominatedByUserId` | `dpoApprovedByUserId` | `DisposalBatch_maker_checker_distinct` |
| 5 | `DataSharingApproval` | `requestedByUserId` | `approvedByUserId` | `DataSharingApproval_maker_checker_distinct` |
| 6 | `DataProcessingAgreement` | `assessedByUserId` | `dpoApprovedByUserId` | `DataProcessingAgreement_maker_checker_distinct` |
| 7 | `Settlement` | `approvedByUserId` | `secondApproverUserId` | `Settlement_maker_checker_distinct` |
| 8 | `CommissionLedgerEntry` | `overrideRequestedByUserId` | `overrideApprovedByUserId` | `CommissionLedgerEntry_maker_checker_distinct` |
| 9 | `Recommendation` | `draftedByUserId` | `approvedByUserId` | `Recommendation_maker_checker_distinct` |

**Six more pairs exist beyond the nine**, each with its own constraint:
`AccessRecertificationItem_maker_checker_distinct` (`subjectUserId` ≠ `reviewerUserId`),
`NeedsAssessment_reviewer_maker_checker_distinct`,
`NeedsAssessment_approver_maker_checker_distinct` (two pairs on one table — one shared
column would let a declared combined *review* excuse a self-*approval*),
`Complaint_closure_maker_checker_distinct`,
`DataSubjectRequest_closure_maker_checker_distinct`,
`IncidentReport_classification_maker_checker_distinct`.

**Re-stating the earlier count against today's tree.** The previously-reported "64 code
sites and 15 DB constraints" measures as: **62 occurrences of `assertDifferentActors` in
`apps/api/src`** including specs; **47** excluding `*.spec.ts`; **46** excluding also the
util's own file; across **30 distinct files**. The difference from 64 is scope and elapsed
time, not a withdrawn constraint — the DB side is unchanged at 15. A second engine,
`DutySegregationService.resolve()`, is called at **17 sites** and is what lets a declared
single-person office proceed while recording the act.

## A.6 The Transition Engine — and the violation count

**Does a single `transition()` function exist?** Yes —
`apps/api/src/modules/workflow/workflow-transition.service.ts:64`,
`WorkflowTransitionService.transition()`. It:

1. loads the row and refuses to advance a **discarded** record;
2. refuses a move to the status it is already in;
3. validates the edge against `WORKFLOW_TRANSITIONS` and, on refusal, **names the allowed
   next states**;
4. writes **conditionally on the status it observed** (`where: { id, status: fromStatus }`),
   so a concurrent transition loses the race explicitly with a 409 instead of being
   silently overwritten;
5. writes the `TRANSITION` audit row **in the same `$transaction`** as the status change.

**Is it mandatory on every status enum the backlog lists?** The backlog A.6 names 11:
`OpportunityStatus`, `RfqInsurerStatus`, `PolicyStatus`, `EndorsementStatus`,
`ClaimStatus`, `ComplaintStatus`, `RenewalStatus`, `InvoiceStatus`, `DsrStatus`,
`IncidentStatus`, `DisposalBatchStatus`. **All 11 are covered.** The engine governs **18**
entity types — the 11 plus `Lead`, `KYCRecord`, `Customer`, `NeedsAssessment`,
`InsuranceProgram`, `CrossSellOpportunity`, `UpSellRecommendation`.

### THE VIOLATION MEASUREMENT

Method: parse every `.ts` under `apps/api/src` (1,064 files), find each
`.<model>.(create|update|updateMany|upsert|createMany)(` call, take its balanced argument
list, and report those setting `status` **in the payload** — distinguishing that from
`status` appearing only in a `where` clause, which is the opposite of a violation (it is
the race-safe conditional).

| Result | Count |
|---|---|
| Prisma writes whose arguments mention `status:` | 49 |
| …of which `status` appears **only in `where`** (the race-safe guard) | 11 |
| **Writes setting `status` in the payload** | **38** |
| …of those, on an **engine-governed** entity | **0** |
| …the engine's own write (`workflow-transition.service.ts:127`) | 1 |
| …on models the engine does **not** govern | **36** |
| …the guard spec's own planted example | 1 |

**Zero direct status writes on any of the 18 governed entities.** The repo already guards
this: `apps/api/src/modules/workflow/status-writes.inventory.spec.ts` asserts
`directStatusWrites()` is empty across three roots (`apps/api/src`, `packages/db/src`,
`apps/api/scripts`), plus a second test that no `$executeRaw` updates a status column. It
is fail-on-any. Its own header records that a single-line
`data: { status: 'X' }` once defeated it and was fixed only after being planted.

**The 36 writes outside the engine sit on 15 models the engine's map does not contain:**
`BrokerLicense`, `CommissionLedgerEntry`, `InternalAuditFinding`,
`OrganizationEmailIntegration`, `PaymentChannel`, `ReconciliationException`,
`RetentionCase`, `RiskRegisterItem`, `Role`, `ScreeningMatch`, `ServiceRequest`,
`SlaPolicy`, `TransactionMonitoringAlert`, `WatchlistDatasetVersion`, `WatchlistSyncRun`.

**The scope of what is guarded, stated plainly.** 36 of the 139 models carry a top-level
`status` field. 18 are governed by the engine and guarded at zero. **18 are not governed**
— so for those, a status is written directly and no allowed-transition map, no `TRANSITION`
audit row and no race-safe conditional applies. Several are configuration rather than
workflow (`Role.status`, `SlaPolicy.status`, `OrganizationEmailIntegration.status`,
`WatchlistSyncRun.status`); others are arguably workflow (`ServiceRequest.status`,
`RetentionCase.status`, `ScreeningMatch` case status, `TransactionMonitoringAlert.status`,
`ReconciliationException.status`, `InternalAuditFinding.status`, `RiskRegisterItem.status`),
and 7 of those 18 are typed `String` rather than an enum.

**Consequence for the new documents, since that is what the question was for.** The broker
document's 15 states and the Gate document's 10 states, if they land on a *new* entity
registered in `WORKFLOW_TRANSITIONS`, inherit validation, the audit row and the race
guard. If they land on one of the 18 ungoverned models, none of that applies today.

## A.7 Money precision

| Question | Answer | Evidence |
|---|---|---|
| Fils-precision integers or floats? | **Neither integers nor floats — `Decimal`** | 60 `Decimal` columns, every one with an explicit precision: **44 at `@db.Decimal(18, 3)`** (JOD at fils precision), 15 at `(5, 2)` (rates/scores), 1 at `(7, 4)` (`LossRatio.ratio`). **0 `Decimal` columns without an explicit precision.** All arithmetic goes through `apps/api/src/common/money.util.ts` |
| Any float in a monetary path? | **No** | **3 `Float` columns in the whole schema**: `ScreeningMatch.matchScore`, `ScreeningMatch.reviewThreshold`, `SlaPolicy.warningThreshold` — all ratios/scores in 0..1 |
| Is there a build-pipeline check that fails on float in a monetary path? | **Yes — two, in both directions** | `apps/api/src/common/float-money.inventory.spec.ts` names every `Float`/`Double` with a reason and fails on an undeclared one, on a stale allow-list entry, **and** on an allow-listed float whose name reads like an amount. `apps/api/src/common/money-fields.inventory.spec.ts` fails if any `Decimal` column is not classified into exactly one of `MONEY_DECIMAL_FIELDS` (44) or `NON_MONEY_DECIMAL_FIELDS` (16) — 60 total, matching the schema histogram exactly. Both run under `npm run test` and therefore in CI |

The float guard's own header records *why* the second spec was needed: the first one
inventories `Decimal` columns, so a `Float` column was invisible to it by construction —
established by planting `plantedFloatAmount Float` on `Invoice` and watching all seven of
its tests pass.

## A.8 SLA timers and escalation

| Question | Answer |
|---|---|
| How many timers exist? | **20 entries in `SLA_REGISTRY`** (`apps/api/src/modules/sla/sla-registry.config.ts`). The backlog A.8 names 14 types; all 14 are present, plus 6 more: `kyc_standard_review`, `kyc_edd_review`, `sanctions_match_review`, `service_request_fulfilment`, `complaint_resolution`, `vendor_termination_access_revocation` |
| How many have an actual escalation job rather than a text note? | **20 of 20 carry 2 `escalationStages` each**, and one real job sweeps them: `SlaTimerScheduler`, `@Cron('*/15 * * * *', { name: 'sla-timer-escalation-sweep' })`. It records breaches **first and separately** from escalation, because escalation fires on raw `dueAt` while a breach is the pause-adjusted question |
| How many are actually started by live code? | **19 of 20.** `claim_followup_insurer_response` is referenced only by `sla-policy-source.config.ts` — no service starts that timer. Its escalation is instead implemented by a **separate mechanism**: `ClaimFollowUpAlert` rows driven by `@Cron('0 7 * * *', { name: 'claim-followup-alert-sweep' })`. So the obligation is met; it does not run through `SlaTimer` |

**15 named `@Cron` jobs** exist in non-spec API source. `SlaTimer` carries pause/resume
(`pausedAt`, `pausedTotalMs`) and stores accumulated pause rather than mutating `dueAt`, so
"when was this due?" and "how long did you have?" are both recoverable.

## A.9 Data masking and leakage prevention

| Backlog sub-item | Present | Evidence |
|---|---|---|
| Partial masking in list views, full reveal only via justified drill-down | **Yes** | `apps/api/src/common/masking.util.ts`, consumed by `customer.service.ts` and `employee.service.ts`. `apps/api/src/modules/security/sensitive-field-reveal.service.ts` is the reveal path, and it writes an `action: 'READ'` row with `isSensitiveDataAccess: true` |
| Watermarking + export/print restriction on `HIGHLY_CONFIDENTIAL` | **Yes** | `apps/api/src/modules/security/document-export.util.ts` |
| Secure-channel-only picklist for highly classified data sharing | **Yes** | `apps/api/src/modules/security/secure-channel.util.ts`; `assertSecureChannel(dto.classification, dto.channel)` called at `data-sharing-approval.service.ts:51` |
| Privacy-by-default form design — no pre-filled sensitive fields | **Yes, and enforced by a correctness argument** | The contact-correction form prefills **nothing**, because phone and email arrive **masked** on the detail read — prefilling would write the mask back as the customer's phone number |

Field-level encryption: **8 models carry an inline `-- ENCRYPT` marker** (`MfaCredential`,
`CustomerIdentifierCorrection`, `Employee`, `Customer`, `UltimateBeneficialOwner`,
`InsuredPerson`, `ThirdPartyClaimant`, `OrganizationEmailIntegration`). `ENCRYPTED_FIELDS`
is a hand-kept map pinned by exact equality, so a new encrypted field is a reviewed change.

## B — Database

| Question | Answer |
|---|---|
| Total model count | **139** |
| Total enum count | **62** |
| Models carrying `organizationId` | **130** |
| …with RLS **enabled** | **130** |
| …with RLS enabled **and a policy** | **130** |
| Org-carrying models with no RLS | **0** |
| RLS tables not carrying `organizationId` | **0** |

The 9 models without `organizationId` are the global catalogues and the tenant root
itself: `Organization`, `Permission`, `InsuranceLine`, `InsurerMaster`,
`InsurerFormTemplate`, `InsurerFormField`, `WatchlistEntry`, `WatchlistDatasetVersion`,
`WatchlistSyncRun`.

**The policies fail closed.** Each is
`USING ("organizationId" = current_setting('app.current_org_id', true))` with `WITH CHECK`
mirroring it. `current_setting(..., true)` returns NULL when unset and
`"organizationId" = NULL` is NULL, not true — so a connection that never sets the variable
sees **nothing**, never everything. `WITH CHECK` means a row cannot be inserted or updated
into another Organization even when its id is named explicitly.

**Does the coverage test still exclude views? YES — still true.** The test is
`apps/api/test/tenant-isolation.e2e-spec.ts`, *"every tenant-scoped table has RLS enabled
and a policy on it"*, and its query filters `AND c.relkind = 'r'` — ordinary tables only. A
view is `relkind = 'v'`.

**There is exactly one view, and it is deliberately outside RLS.** `InsurerDirectory`,
created `WITH (security_invoker = false)` in
`20261012100000_insurer_directory_view` and recreated in `20261013100000`. Its own
migration states the mechanism: the view executes with its **owner's** privileges, so it —
and only it — sees every office's `Insurer` rows, and it discards every office-scoped
column before returning anything. It is not auto-updatable (aggregating `GROUP BY`) and the
grant is `SELECT` only. **This is the one deliberate cross-organization read path in the
system** and matters for § 4.19.

**`FORCE ROW LEVEL SECURITY` is set on only 4 tables** —
`CustomerIdentifierCorrection`, `DuplicateNameWarning`, `LegacyImportBatch`,
`LegacyImportIssue`. `FORCE` matters only for the table **owner**; the runtime role
`ibms_app` is not the owner, and migration `20261018100000_app_role_privilege_assertion`
refuses to deploy if it is a superuser, while `tenant-isolation.e2e-spec.ts` asserts it
holds membership in **no** other role — because the owner is exempt from its own RLS.

**10 composite tenant foreign keys** make a cross-office reference unrepresentable rather
than merely filtered:
`CommissionAgreement_office_line_same_org_fkey`,
`InsuranceProgramLine_office_line_same_org_fkey`,
`InsurerOfferedLine_insurer_same_org_fkey`,
`InsurerOfferedLine_office_line_same_org_fkey`,
`OfficeInsurerFormField_template_same_org_fkey`,
`OfficeInsurerFormTemplate_insurer_same_org_fkey`,
`OfficeInsurerFormTemplate_office_line_same_org_fkey`,
`Policy_office_line_same_org_fkey`,
`RFQ_office_line_same_org_fkey`,
`RolePermission_role_organization_agree_fkey`.

**`db:divergence` has a measured blind spot** recorded in the repo: it does not see partial
indexes, CHECK constraints, or RLS. Those are asserted in their own migrations' `DO` blocks
instead.

## D — PDPL (Part D's nine items)

All nine have a model, routes, a screen, and a Playwright spec that drives the screen.

| Item | State | Models | Routes | Screen | Roles who can reach it |
|---|---|---|---|---|---|
| 1 Consent | `WALKABLE` | `ConsentRecord` | 5 | `/consent` | 4 |
| 2 Data Subject Requests | `WALKABLE` | `DataSubjectRequest` | 13 | `/dsr` | 5 |
| 3 Retention & Disposal | `WALKABLE` | `RetentionScheduleItem`, `LegalHold`, `DisposalBatch`, `CertificateOfDestruction` | 8 | `/retention-disposal` | 3 |
| 4 Cross-Border Transfer | `WALKABLE` | `CrossBorderTransferRecord` | 3 | `/cross-border-transfers` | 1 |
| 5 Third Parties & Data Sharing | `WALKABLE` | `Vendor`, `DataProcessingAgreement`, `DataSharingApproval` | 5 | `/data-sharing-approvals` | 6 |
| 6 DPIA Screening | `WALKABLE` | `DpiaScreening` | 6 | `/dpia-screenings` | 1 |
| 7 Notices | `WALKABLE` | `PrivacyNotice` | 5 | `/privacy-notices` | 5 |
| 8 RoPA | `WALKABLE` | `RopaEntry` | 5 | `/ropa-entries` | 1 |
| 9 DPO Workspace | `WALKABLE` | — | 1 | `/dpo-workspace` | 1 |

### The two specific questions

**Is the retention schedule table empty?**
**Not measurable live (Docker down). From the seed: it is NOT empty — it holds exactly ONE
row, and that row is a declared draft.** `packages/db/prisma/seed-data/retention-schedule.ts`
seeds a single `RetentionScheduleItem`: `recordCategory: "AuditLogEntry"`,
`retentionPeriodMonths: 120`, with a `legalBasis` that opens *"DRAFT, UNCONFIRMED — no
specific figure is cited anywhere in ibms-brain/meta for AuditLogEntry"*. The file's own
header says *"Do not treat this number as authoritative"* and that
`confirmedByLegalCounselAt` stays `null` until someone with the authority confirms it.

So the earlier shorthand "the retention table is empty" is **wrong in a way that matters**:
there is one category of 139 models' worth of record types, it is the audit log, its figure
is unconfirmed, and **no customer, policy, claim or quotation record category is listed at
all**. The practical consequence is the same as empty for every business record type, but
the statement should be the precise one.

**Does consent exist at the RFQ / market-placement touchpoint?**
**Yes.** `apps/web/app/(app)/rfqs/[id]/page.tsx:255` mounts `ConsentCaptureWidget`.

Six screens mount that widget: `/customers/[id]`, `/needs-assessments/[id]`,
`/rfqs/[id]`, `/opportunities/[id]`, `/cross-sell/[id]`, `/up-sell/[id]`. Against the
backlog's seven named touchpoints:

| Touchpoint | Surface |
|---|---|
| Lead capture | **Yes**, but not via the widget — `marketingConsentGranted` is a **required** boolean on `CreateLeadDto` (`create-lead.dto.ts:40`, no default) |
| Onboarding / KYC | `/customers/[id]` |
| Needs & risk assessment | `/needs-assessments/[id]` |
| **RFQ / market placement** | **`/rfqs/[id]`** |
| Claims | **No consent control on `/claims/[id]`** |
| Group Medical/Life & Motor Fleet | Not separately surfaced — `InsuredPerson` has no CRUD screen |
| Renewal & cross/up-sell | `/cross-sell/[id]`, `/up-sell/[id]` |

`ConsentRecord` holds `isMarketing` separate from `purpose`, `granted` defaults **false**
(pre-ticked boxes prohibited), and carries `withdrawnAt` with a 2-business-day SLA
(`consent_withdrawal`, 2 escalation stages). `ConsentPurpose` is `UNDERWRITING | CLAIMS |
MARKETING | KYC_AML | SHARING_WITH_INSURER | OTHER`.

## E — Dashboards

**All seven of Part E's items exist as screens.** None is a query with no screen.

| Part E item | Screen | Branch | Line | Insurer | Time period |
|---|---|---|---|---|---|
| Sales Dashboard | `/dashboards/sales` | ✓ | ✓ | ✓ | ✓ (`periodStart`/`periodEnd`, `from`/`to`) |
| Policy Dashboard | `/dashboards/policy` | ✓ | ✓ | ✓ | ✓ |
| Claims Dashboard | `/dashboards/claims` | ✓ | ✓ | ✓ | ✓ (`from`/`to`, `asOf`) |
| Financial Dashboard | `/dashboards/financial` | ✓ | ✓ | ✓ | ✓ |
| Compliance Dashboard | `/dashboards/compliance` | ✓ | **✗** | **✗** | ✓ |
| Insurer & Employee Performance | `/dashboards/insurer-employee-performance` | ✓ | **✗** | ✓ | ✓ |
| *"Every dashboard filterable by branch/line/insurer/time period, and renderable in either language"* | — | **7/7** | **5/7** | **5/7** | **7/7** |

Beyond Part E's six named dashboards, `/dashboards/executive` also exists (#64) — with
branch, line and time filters, no insurer filter. **`/dashboards/executive` is the one
dashboard screen no Playwright spec drives.**

`docs/what-each-dashboard-reveals.md` records what each one discloses; eight of the
fourteen reporting surfaces reveal commission, and two reveal commission **per employee**.

## F — Bilingual: hardcoded strings on a screen a user reaches

**English: 0, with a stated ceiling.** `python scripts/measurements/hardcoded-ui-english.py`
→ `screens scanned 102 / screens with hardcoded English 0 / strings 0`. **That is zero of
what that detector can see**, and its own header lists **six blind spots and one counting
defect**, every one found by reading a screen for another reason — including one pass that
read 0/102 while 21 English labels stood on 14 screens.

**Arabic: measured here for the first time, and it is not zero.** No existing script covers
the Arabic half. Method: every `.ts`/`.tsx` under `apps/web` **except**
`apps/web/lib/i18n/**` (the dictionary, where Arabic belongs), `*.spec.*`, `apps/web/e2e/**`
and `apps/web/test/**`; a hit is a line containing any character in U+0600–U+06FF.

| Scope | Count |
|---|---|
| Files scanned | 300 |
| Dictionary files skipped | 34 |
| Lines with Arabic in a comment | 4 |
| **Lines with Arabic in code** | **37**, across 8 files |

Classified by hand — the raw 37 is not the finding:

| Class | Lines | Where | What a reader sees |
|---|---|---|---|
| **Unconditional Arabic on a reachable screen** | **3** | `/knowledge-base` — `page.tsx:139` `العنوان (Arabic, optional)`, `:157` `النص (Arabic, optional)`, `:176` `<th>العنوان</th>` | **Every reader, in either language.** Each sits directly beside a translated sibling (`{t('kbTitleEn')}`, `{t('kbColTitle')}`) — one label translated, the next hardcoded. The English detector reads 0 here, which is a seventh instance of its blind-spot class |
| **Both languages inline, outside the dictionary** | **19** | `/sla-policies` (10), `/screening-health` (7), `/renewal-cases:97` (1), `/settings/users:394` (1) | No language leak — each is `isArabic ? … : …`. But the copy lives in the screen, not in `translations/`, so these are a second home for UI text |
| …of which the **English** branch returns a **raw enum token** | **7** | `/screening-health` — `statusLabel` returns `status` and `providerLabel` returns `kind` unchanged when not Arabic | An English reader sees `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `NOT_CONFIGURED`, `built_in`, `on_premise`, `commercial` — raw tokens, which the UX directive § 2 forbids |
| **Not screen copy** | **15** | `lib/admin/permission-descriptions-input.ts` (12 — generator input for the owner's description file; the screen uses a separate `MODULE_LABEL` map of translation keys), `lib/admin/permission-matrix.test.ts` (2 — a test), `components/admin/PermissionMatrix.tsx:219` (1 — a comment) | Nothing |

**So the answer to the question as asked:** **3 hardcoded strings reach every user on one
screen (`/knowledge-base`), 19 more live outside the dictionary on four screens, and 7 of
those leave an English reader looking at a raw enum.** The English-only detector reports
zero across all of them.

---

# PART THREE — Nineteen specific measurements

## 1. Master request vs per-insurer quote request

**The split exists. The numbering does not.**

`RFQ` → `RFQInsurer[]` implements one-request-many-quote-requests structurally:
`RFQInsurer` carries `rfqId`, `insurerId`, its own `status`, `sentAt`, `respondedAt`,
`followUpAlertSentAt`, and `@@unique([rfqId, insurerId])`.

**Neither carries a human-readable reference number.** `RFQ.id` and `RFQInsurer.id` are
both `String @id @default(uuid())`. Sweeping every model for a field named
`*number*`/`*reference*`/`*ref`/`code` finds **no reference field on `RFQ`, `RFQInsurer`,
`Opportunity` or `Quotation`** (`Quotation.versionNumber` is an `Int` version counter, not
a quote reference). So there is **no `BR-2026-000125` and no `-C01` suffix**, and no format
to report.

**The two documents describe different depths and this should not be resolved silently.**
`تطوير إجراء عمل التأمين.pdf` § 7 has **two** levels — one Master Request with a Quote
Request per insurer. The repo has **three** — `Opportunity` → `RFQ` (one per insurance
line, `@@unique([opportunityId, insuranceLine])`) → `RFQInsurer` (one per insurer). A
multi-line request is one Opportunity and several RFQs in the repo, and one Master Request
in the document. Which object the broker's `BR-2026-000125` names is not decidable from
the code.

## 2. Non-selection notification

**Nothing is sent, and no notification kind exists.**

`NOTIFICATION_KINDS` (`apps/api/src/modules/notification/notification.config.ts:32`) holds
**seven** values: `sla_overdue`, `claim_followup`, `aml_alert`, `screening_match`,
`service_request_assigned`, `customer_pending_kyc`, `kyc_awaiting_decision`. None concerns
insurer selection.

Stronger: **`client-decision.service.ts`, `recommendation.service.ts` and
`policy.service.ts` contain zero references to `RFQInsurer`.** So when one insurer is
chosen, nothing at all happens to the others — no notification, and no status change.
`RfqInsurerStatus` is `SENT | VIEWED | QUOTED | DECLINED | NO_RESPONSE`; there is **no
`NOT_SELECTED` value**, so a passed-over insurer's record stays at `QUOTED` permanently.

The broker document § 13 requires a `Non-Selection Notification` with specific wording, and
the Gate document § 10 requires the insurer side to *"record non-selection and close the
quote transaction"*. Neither half exists.

## 3. The insurer record — five fields

| Asked | Field | State |
|---|---|---|
| **(a) remittance period in days** | **`Insurer.creditTermsDays Int?`** — settable at registration (`insurer-crud.dto.ts:184` and `:296`) | Exists. Its schema comment calls it *narrative process 31 "Credit Terms"*; whether "credit terms" is the same thing the broker calls مدة التوريد is a naming decision, not a code fact |
| **(b) quote-response deadline** | **`InsurerSlaAgreement`** — `slaType` (`response_time \| claim_handling \| quote_response \| policy_issuance`), `targetDays Int`, `effectiveFrom` | **`MODEL_ONLY`.** Zero `insurerSlaAgreement.create/update/upsert/delete` calls anywhere. Read **only** by `insurer-performance.repository.ts` for scoring. There is no route and no screen to agree a figure at registration |
| **(c) claim-response deadline** | same model, `slaType = 'claim_handling'` | **`MODEL_ONLY`**, same reason |
| **(d) its own forms/templates** | `OfficeInsurerFormTemplate` + `OfficeInsurerFormField` (office's own copy, versioned, with composite tenant FKs) and `InsurerFormTemplate` + `InsurerFormField` (global, per `insurerMaster` + line) | **`ENDPOINT_ONLY`.** Routes exist (`GET`/`POST /insurers/:id/form-templates`, `GET .../resolved`, `GET`/`POST /insurer-masters/:id/form-templates`, `.../current`) and **every one has no web caller** |
| **(e) a financial account with the broker** | **Does not exist** | There is no insurer account, balance or statement model. `Insurer` relates to `remittances` and `paymentChannels`; `/insurer-accounting` is a payables/ageing **query** over `Remittance`. The only ledger models are `ClientFundsLedgerEntry` (customer-side, single-sided: `amount` + `direction` in\|out) and `CommissionLedgerEntry` |

The broker's framing — all three periods per-insurer and agreed at registration,
*"variables, not static"* — is **structurally anticipated** by `InsurerSlaAgreement` with
its `effectiveFrom` and no write path. One field (a) is live; two (b, c) have a table and
no way to fill it.

## 4. The claim status for "no response in time"

**No such status exists.** `ClaimStatus` has nine values:
`NOTIFIED`, `REGISTERED`, `DOCUMENTATION_IN_PROGRESS`, `UNDER_ASSESSMENT`, `APPROVED`,
`PARTIALLY_APPROVED`, `DECLINED`, `SETTLED`, `CLOSED`.

**The concept exists under a different shape.** `claim.config.ts:568` declares
`CLAIM_AWAITING_INSURER_STATUSES`; the claim view carries a derived
`awaitingInsurerResponse: boolean` and `awaitingInsurerSince: Date | null`
(`claim.config.ts:636–662`); and `ClaimFollowUpAlert` rows are raised by
`claim-followup.scheduler.ts`, `@Cron('0 7 * * *')`, for every claim still awaiting a
response past the threshold. So the system **detects and alerts on** insurer
non-response — it does not move the claim into a status named for it.

**The document she may have meant is not on this machine.** Her answer to ع٥ says the name
is *"in the second file"* (`الها اسم في الملف نسيت شو هو`). Searched: **no file matching
`*claim*` in `C:\Users\user\Downloads\IBMS-DOC` and none in `docs/`.** The seven files in
IBMS-DOC are the two Arabic process PDFs, `IBMS.docx`, the Gate `.docx`, the backlog, the
UX directive and `MULTI-TENANCY-SPEC.md`; none is a claims process document. Neither Arabic
PDF names a claim-timeout status — `تطوير إجراء عمل التأمين.pdf` § 23 covers the
*quotation* non-response case (`Quote Pending → Reminder → Escalation → Expired`), not
claims. **I could not find the document; it may not have been shared.**

## 5. The seven finance operations — and the level they sit at

All seven exist as routes. **None of them is reachable from `/policies/[id]`.** All of them
are rendered on **`/opportunities/[id]`**, except claim settlement, which is on
`/claims/[id]`.

| # | Operation | Route | Rendered on | Component |
|---|---|---|---|---|
| 1 | Invoice | `POST /invoices` | `/opportunities/[id]` | `components/policy/FinanceSection.tsx:325` |
| 2 | Receipt | `POST /invoices/:id/receipt` | `/opportunities/[id]` | `FinanceSection.tsx:389` |
| 3 | Commission | `POST /commission/entries`, `.../override`, `.../override/approve` | `/opportunities/[id]` **and** `/commission` | `components/policy/CommissionSection.tsx` |
| 4 | Refund approval | `POST /refunds/:id/approve` | `/opportunities/[id]` | `components/policy/EndorsementSection.tsx` |
| 5 | Settlement approval | `POST /claims/:id/settlement`, `.../second-approve` | `/claims/[id]` | `ClaimSection` |
| 6 | Disbursement | `POST /refunds/:id/disburse` | `/opportunities/[id]` | `EndorsementSection.tsx` |
| 7 | Settlement / payment (remittance) | `POST /invoices/:id/remittance` | `/opportunities/[id]` | `FinanceSection.tsx:431` |

**`/policies/[id]` renders exactly three things:** `PolicyDetail`, `PolicyCheckingBlock`
(#20) and `NotifyClaimForm` (#23). **Zero finance.**

So the answer is neither of the two offered: **the seven operations live at OPPORTUNITY
level**, not policy and not customer. The components are even *named* for a policy and
filed under `components/policy/` — they are mounted on the opportunity screen.

### And the Finance Officer cannot open that screen

This is the sharpest finding in the audit. **`FINANCE_COLLECTIONS_OFFICER` holds 32 codes,
including `invoice.create`, `receipt.record`, `remittance.record`, `refund.approve`,
`refund.disburse` and `claim.settle.second-approve` — and holds none of `opportunity.read`,
`policy.read` or `claim.read`.**

- the nav entry for `/opportunities` is gated on `opportunity.read` → Finance does not see it;
- `/policies` on `policy.read` → does not see it;
- `/claims` on `claim.read` → does not see it;
- and typing the URL does not help: `GET /opportunities/:id` is gated on `opportunity.read`
  (`modules/opportunity/opportunity.controller.ts`), so the screen cannot load either.

Finance **can** reach `/client-accounting`, `/insurer-accounting`, `/commission`,
`/bank-reconciliation`, `/payment-channels`, `/financial-report` and `/customers` — the
read-only reports. **Not one screen carrying a finance write control.**

**Measured as a class, not an anecdote.** Across the 69 process rows with screens there are
263 (permission, holder) pairs; **14 pairs are a role holding a process's permission with
no navigation route to any of that process's screens**:

| Process | Permission | Holders with no route |
|---|---|---|
| #22 Endorsement Management | `refund.approve` | FINANCE |
| #28 Claim Settlement | `claim.settle.second-approve` | FINANCE |
| #31 Premium Billing | `client-accounting.read` | EXTERNAL_AUDITOR, FINANCE |
| #31 Premium Billing | `invoice.create` | FINANCE |
| #32 Collection | `receipt.record` | FINANCE |
| #32 Collection | `remittance.record` | FINANCE |
| #37 Refund Management | `refund.approve` | FINANCE |
| #37 Refund Management | `refund.disburse` | FINANCE |
| #39 Bank Reconciliation | `reconciliation-exception.resolve` | BRANCH_DEPARTMENT_MANAGER |
| #55 Incident Management | `incident.classification.co-sign` | EXECUTIVE_MANAGEMENT |
| #70 Document Management | `document.delete-override` | DPO, SYSTEM_SECURITY_ADMINISTRATOR |
| #71 Vendor Management | `dpa.approve` | DPO |

The previously-recorded single instance (`refund.disburse`, Finance, § 1.75) is **one of
fourteen**.

## 6. No net settlement

**A net figure is computed AND stored, in four places. This contradicts the broker's
explicit instruction.**

His answer to ع٤ / و٦: *"بتورّد ١٠٠٠ وبتستلم ١٢٠ ما بورد الصافي بيقسمهم ل جزئين"* — remit
1,000 and receive 120; never remit the net; split it into two movements. And on the refund:
pay the 50 and collect the 300.

| Where | What is stored | Source |
|---|---|---|
| **The invoice the client receives** | `totalAmount = premium + tax + fees − commissionDeducted` | `finance.config.ts:29`; computed server-side, the DTO refuses the field |
| **The remittance to the insurer** | `Remittance.amount = premium − commissionDeducted` | `computeRemittanceAmount` (`finance.config.ts:317`), called at `collection.service.ts:471`, written at `invoice.repository.ts:520`. Its own refusal message reads *"The net remittance would be negative"* |
| **Insurer-accounting views** | the same net | `finance.config.ts:529`, `:1055`, `:1096` |
| **The bank-reconciliation comparison** | the broker's own side of the variance is the net | `reconciliation.service.ts:160` |

`computeRemittanceAmount`'s own comment states the model: *"the net premium the broker owes
the insurer for a fully-collected invoice: the issued premium less the broker's commission.
Tax and fees stay with the broker."*

**Two separate disagreements, named without being resolved:**

1. **Direction.** The broker document § 18 charges the customer **170** and owes the insurer
   **150**, with **20** as brokerage revenue — the customer pays *more* than the insurer
   receives. The repo computes `totalAmount = premium + tax + fees − commission` — the
   customer pays *less* than the premium. These are opposite commercial models.
2. **Netting.** The broker's interview answer forbids remitting the net. The repo computes,
   stores and reconciles against the net.

The backlog's own #31 line says *"Premium + tax + fees, **net of commission**, with a due
date"* — so the repo implements the backlog faithfully and the backlog disagrees with the
broker. **Both are named; neither is picked.**

No path was found that records a commission **receipt** from the insurer as its own
movement: commission is realised by deduction.

## 7. Commission rate frozen at issuance

**It reads the rate as of the policy's inception date, not the current rate. The broker's
rule is implemented.**

`invoice.service.ts:297`, `resolvePolicyCommissionRate(insurerId, insuranceLine,
inceptionDate, opportunityId)`:

1. `findEffectiveAgreement(insurerId, insuranceLine, inceptionDate)`
   (`commission.repository.ts:224`) selects the agreement where
   `effectiveFrom <= inceptionDate` and (`effectiveTo IS NULL` or
   `effectiveTo > inceptionDate`), most recent first;
2. if no agreement covers that date, it falls back to the **quotation's captured**
   `commissionRatePercent` — the rate the policy was placed at.

So a rate changed after issuance does not reach an already-issued policy. This matches و٤:
*"النسبة الاساسية حتى لو تغيرت العمولة بعد الاصدار لا يشملها... القديم ثابت"*.

**One dependency worth stating:** the rate is **not stored on the `Policy`** — it is
re-resolved from the agreement history on every invoice. Correctness therefore depends on
the history being preserved as windows. `commission.repository.ts:245` does open a new
window and close the prior one in a single `$transaction`, which is the shape that keeps it
true; an in-place edit of `ratePercent` or `effectiveFrom` on an existing row would change
an already-issued policy's commission on its next invoice.

## 8. Unbalanced posting

**There is nothing that blocks `debit != credit`, because there is no debit or credit.**

There is **no general ledger, no journal, no posting and no chart of accounts** in the
schema. Searching all 139 models for a name containing account / ledger / balance /
journal / posting / entry / chart returns: `AuditLogEntry`, `ClientFundsLedgerEntry`,
`CommissionLedgerEntry`, `PasswordHistoryEntry`, `RopaEntry`, `WatchlistEntry` — and the
only two financial ones are single-sided:

- `ClientFundsLedgerEntry`: `customerId`, `amount`, `direction` (`"in" | "out"`),
  `reference?`, `recordedAt`;
- `CommissionLedgerEntry`: commission amounts, VAT, paid/outstanding/reversed.

Neither has a counter-leg, an account code, or a transaction grouping two or more legs. So
the broker document § 22.6 (*"the system must prevent Posting if Debit ≠ Credit"*) has no
object to apply to.

**What does exist** is a per-figure guard rather than a balance guard: `computeVariance`
never rounds a variance away, and a non-zero variance **always** raises a
`ReconciliationException`.

## 9. The three-leg entry and the chart of accounts

**There is no chart of accounts and no master-data definition of brokerage revenue.**

The documents' example — Customer receivable 170, Insurer payable 150, Brokerage revenue
20 — has no representation. There is no account master table, so the 20 cannot be posted to
a *typed* account.

**But the amount is not untyped either, and that distinction matters.** The broker's margin
is held as `CommissionLedgerEntry` with `amount`, `vatAmount`, `vatRatePercent`,
`ratePercent`, a link to the governing `CommissionAgreement`, and override/reversal
columns — so it is *identified as commission*, with its rate and its VAT, rather than
stored as a bare difference. What is missing is the **balanced three-leg entry** and the
**account definition**, not the nature of the amount.

Both documents warn against exactly this. `تطوير إجراء عمل التأمين.pdf` § 19: *"I advise
that the 20 dinars not be treated as a mere 'price difference' inside the system; there must
be a clear definition in the Master Data: Broker Revenue / Commission / Brokerage
Income."* `Insurance_Company_Process_Brokerage_Gate.docx` § 14: *"the system should not
assume its nature without Master Data and an approved accounting rule."* **Measured: no
such Master Data exists.**

## 10. Policy duplicate prevention

**No constraint covers the four things together.**

Every unique index on `Policy` today:

| Index | Columns |
|---|---|
| `Policy_organizationId_policyNumber_key` | `(organizationId, policyNumber)` |
| `Policy_opportunityId_key` | `(opportunityId)` |

The broker document § 22.7 requires the check on **policy number + insurance company +
customer + policy period**. What exists is narrower on three axes and stricter on one:

- **stricter**: the same `policyNumber` cannot be reused in an office even for a *different*
  insurer or customer;
- **absent**: the same customer + insurer + period with a *different* number is accepted;
- `policyNumber` is nullable, so a policy placed but not yet issued collides with nothing
  (Postgres treats NULLs as distinct) — correct for that state.

A global `Policy_policyNumber_key` existed and was **deliberately dropped** by
`20260926100000_tenant_scoped_unique_constraints`, because a uniqueness violation across
offices would confirm another office holds that number.

Phase 2's duplicate prevention is a different mechanism on different entities
(`DuplicateNameWarning` for customers; a pre-check plus index for employees) and does not
reach policies.

## 11. Zero premium — both halves of the contradiction

**Confirmed. Both halves stand, and no permission governs either.**

| Path | Behaviour | Evidence |
|---|---|---|
| **Quotation** | **Refuses zero** | `quotation.config.ts:113` — *"premium must be greater than zero — a quotation with no premium is not a quote"* |
| **Issuance** | **Accepts zero freely** | `policy.service.ts:645–648` — `const issuedPremium = quantizeMoney(dto.issuedPremium); if (issuedPremium.isNegative()) throw ... 'issuedPremium cannot be negative.'` Only **negative** is refused |

**No permission exists that could govern it.** Searching all 219 codes for
`zero`/`premium`/`waive`/`exception` returns only `reconciliation-exception.investigate`
and `reconciliation-exception.resolve`, both unrelated. The owner's answer — *"الاصل ما في
قسط صفري، الا اذا بموجب صلاحية"* (no zero premium except under a permission) — has **no
code to grant**: there is no `premium.zero.override` or equivalent.

## 12. Postdated cheques

**No.** Plainly: there is no cheque model, no cheque field, no due date, no due-date report
and no due-date notification.

`cheque` exists only as a **value** in two vocabularies:
`RECEIPT_METHODS = ['bank_transfer', 'cheque', 'card', 'cash']` (`finance.config.ts:47`,
stored in `Receipt.method String?`) and `CHANNEL_TYPES` on `/payment-channels`.

What is missing, against ع٣:

- no cheque number, bank, drawer or image field — `Receipt.reference String?` is free text
  and nothing structures it;
- **no due date anywhere.** `Receipt` carries `receivedAt` — a payment *already received*.
  There is no forward-dated payment record;
- no due-date report, and no notification kind for one (the seven kinds contain nothing
  cheque- or due-date-related);
- instalments *do* exist — an `Invoice` may carry several `Receipt` rows and only the one
  completing it moves the invoice on (`collection.service.ts:299`) — but each is a receipt
  of money already in, not a scheduled future cheque.

So the Finance role cannot be given the follow-up list the client described.

## 13. Forms and field transfer

**The per-insurer form definition exists and is unreachable. The broker's own form and the
field transfer do not exist. There is no form-filling path.**

| Asked | State |
|---|---|
| A form-template model | **Yes.** `InsurerFormTemplate` (global, `@@unique([insurerMasterId, insuranceLineId, version])`) + `InsurerFormField` (`fieldKey`, `labelEn`, `labelAr`, `dataType`, `isRequired`, `options[]`, `displayOrder`), and `OfficeInsurerFormTemplate` + `OfficeInsurerFormField` for the office's own copy. **`ENDPOINT_ONLY`** — all six routes have no web caller |
| **A broker's own form, per insurance line, independent of an insurer** | **No.** Every form template hangs off an insurer — the global one off `insurerMaster`, the office one off `Insurer`. There is no template keyed by **line alone**, which is what و٧ describes (*"the original is that every broker office has its own forms by type of insurance"*) |
| Any field mapping between two forms | **No.** The only `fieldMap` in the API is `customer.service.ts:642`, for identifier corrections — unrelated |
| A PDF-filling path | **No.** `PdfRendererService` exists and renders the six bilingual **document templates** (quotation comparison, recommendation report, policy schedule summary, invoice, certificate of insurance, complaint acknowledgement). Nothing fills an insurer **form** |

So the sequence و٧ describes — fill the broker's own form with the client, transfer the
shared fields into the insurer's form where one exists, send the broker's own form where it
does not — has a model for the *insurer's* form only, that model has no screen, and the
transfer step has no code at all.

## 14. The export permission and the per-office export settings

**Neither exists.**

| Asked | State |
|---|---|
| An `export` permission among the 219 | **No.** The only code containing "export" is **`planning-export.generate`** (EXECUTIVE_MANAGEMENT), which is #65's portfolio/market data export. There is no general export right |
| Per-office setting: whether export is allowed | **No** |
| Per-office setting: which formats (pdf / excel / csv) | **No** |
| Per-office setting: within what deadline | **No** |

`AuditAction.EXPORT` exists and `planning-export` is its first writer, so an export *is*
auditable where it happens. The client's ع٨ answer describes a new permission called
التصدير plus three per-office settings; none of the four is present.

## 15. Retention extension

| Asked | State |
|---|---|
| Base five years | **No.** The only seeded row is `AuditLogEntry` at **120 months (10 years)**, declared a draft. No 60-month default exists anywhere |
| An extend button | **No.** There is no "extend" act. `PATCH /retention-schedule/:id` edits `retentionPeriodMonths` **in place**, so an extension is indistinguishable from a correction |
| Approval by whoever holds the DPO / internal-data-controller role | **Partly, and not as a second pair of eyes.** `POST /retention-schedule/:id/confirm` exists and sets the legal-counsel confirmation. But **the same single code — `retention-schedule.manage` — gates the edit and the confirm**, and it is held by COMPLIANCE_OFFICER and DATA_PROTECTION_OFFICER. Whoever edits can confirm. This pair is **not** among the 15 maker/checker pairs |
| A **mandatory** reason | **No.** `CreateRetentionScheduleItemDto` is `recordCategory`, `retentionPeriodMonths` (`@IsInt() @Min(1)`), and `legalBasis?: string` — **optional**. There is no reason field at all on the update |
| A separate list named "contracts outside the default period" | **No.** Searching for that concept returns nothing |
| Is the retention schedule table empty today? | **Not measurable live (Docker down).** From the seed: one row, `AuditLogEntry`/120 months, a declared draft with `confirmedByLegalCounselAt` null — see § 3.D |

What *does* exist adjacent to this: `LegalHold`, with a **mandatory** `reason String` (not
optional), `nextReviewDueAt`, `releasedAt`, a 6-month necessity-review SLA
(`legal_hold_necessity_review`), and links to `customerId`/`insuredPersonId`. A hold
excludes records from routine disposal. It is a different instrument from a retention-period
extension, and it carries the mandatory reason the extension does not.

## 16. Screening determinants as a setting

**Not configurable. All three determinants are always sent; the thresholds are environment
variables, not an office setting.**

`buildScreeningSubjects` (`apps/api/src/modules/customer/screening-subjects.util.ts:27`)
sends, per subject: `subjectRef`, `fullName`, `entityType`, **`dateOfBirth`** and
**`nationality`** — null where unknown, never guessed. `Customer` does carry
`dateOfBirth DateTime? @db.Date` and `nationality String?`. A corporate customer's own
date of birth is correctly null; the natural persons behind it come through as UBO subjects.

So the broker's three options (name alone / name + DOB / name + nationality / all) are not
a choice the system offers — **it always sends all three it has**.

| What *is* adjustable | How |
|---|---|
| Match thresholds | **Environment variables** — `SCREENING_MATCH_THRESHOLD_HIGH`, `..._REVIEW`, `..._LOW` (`screening-provider.config.ts:29–31`), with `DEFAULT_MATCH_THRESHOLDS` as fallback. Changeable by a deployment, **not** by an office |
| Anything per-office | **Nothing.** `screening-config.controller.ts` exposes exactly **two routes, both `GET`** (`/config`, `/health`), both gated on `sanctions-pep.screen`. There is no write route, no setting, and no permission for changing determinants |

**A recorded defect found while measuring this.** `screening.service.ts:494` states in a
header comment: *"The customer model does not currently capture date of birth, nationality
or country, so only names are available today."* **That is now false** — both columns exist
and `buildScreeningSubjects` sends them. The comment is stale and reads as a live
limitation. Recorded, not fixed.

## 17. Printing

**Nothing can be printed, and no report has its own print permission.**

| Asked | State |
|---|---|
| Can audit-log entries be printed? | **No.** `AuditAction.PRINT` exists in the enum and in the web's mirror (`apps/web/lib/audit-trail/audit-trail-api.ts:31`), and **`'PRINT'` is written 0 times** in `apps/api/src`. There is **no `window.print` call and no `@media print` rule anywhere in `apps/web`** |
| Can reports be printed? | **No**, same measurement |
| Does each report have its OWN permission code? | **Partly — for viewing, not for printing.** There are **0 permission codes containing "print"**. Reports do each have a view code: `dashboard.sales.view`, `dashboard.policy.view`, `dashboard.claims.view`, `dashboard.financial.view`, `dashboard.compliance.view`, `dashboard.executive.view`, `kpi-dashboard.view`, `financial-report.view`, `claims-analytics.view`, `portfolio-analysis.view`, `profitability-analysis.view`, `insurer-performance.view`, `employee-performance.view`, `audit-log.read` |

The client's ع١١ answer requires both: *"every log and every report has its own permission"*
**and** *"there must be the ability to print these logs or reports."* The first half is
largely satisfied for viewing; the second half does not exist, and the audit vocabulary has
a `PRINT` verb with nothing to write it.

## 18. The eleven roles — is any role NAME hardcoded?

**No authorization decision anywhere branches on a role name.** Every gate reads a
permission code.

**Structurally, the client's requirement is already satisfied.** `Role.name` is a plain
`String`, `@@unique([organizationId, name])`. The `RoleName` enum still exists as a type but
**is used as the type of no column** — the only `RoleName`-shaped columns are
`AuditLogEntry.actorRoleNames String[]` and `CombinedDutyAct.grantingRoleNames String[]`,
both plain string arrays recording what was held at the time. The eleven are ordinary
per-office rows carrying legacy machine names. An office defines its own roles at
`/settings/roles`.

**Role names in executable code: three sites, none an authorization decision.**

| File | Lines | What it is |
|---|---|---|
| `apps/api/src/modules/sla/sla-registry.config.ts` | 6 `escalateTo:` values (`DATA_PROTECTION_OFFICER`, `CLAIMS_OFFICER`, `COMPLIANCE_OFFICER` ×2, `BRANCH_DEPARTMENT_MANAGER` ×2) | **SLA escalation routing** — which business function owns a deadline |
| `apps/api/src/modules/notification/notification.config.ts:55–58` | 4 names | **Notification recipients**, following the escalation targets |
| `apps/web/components/app/destinations.ts:418` | `NAV_ORDER_BY_ROLE.EXECUTIVE_MANAGEMENT` | **Nav group ordering and one hoisted card.** Not a gate — it changes the order, not what is visible |

**Plus one display map, which is legitimate and necessary:**
`apps/web/lib/i18n/enum-labels.ts:404–414` maps the eleven names to translation keys so a
seeded role's name renders bilingually.

**Everything else is a comment.** The web sweep found role names in 16 files; reading every
line, all occurrences outside `enum-labels.ts` and `destinations.ts:418` are prose in
comments explaining a measured permission-holder finding (for example
`EntitySearch.tsx:205–206`, recording that an Executive could not find an employee).

**So the count asked for: 0 hardcoded role names in an authorization decision; 11 in one
display map; 11 in three non-authorization code sites (6 + 4 + 1).** The email-settings
case that was fixed is confirmed fixed — `settings/email/page.tsx:98` now carries only a
comment recording that it *used to* read
`user.roles.includes('SYSTEM_SECURITY_ADMINISTRATOR')`, and the gate is the
`diagnostics.view` code.

The two routing sites are a recorded deliberate deferral: they answer *which business
function owns this*, and the stated fix is a routing table, not a permission code.

## 19. Brokerage Gate — insurer as a system user. A measurement of distance.

### Can a user exist who belongs to no Organization?

**No, at two layers.**

**Schema:** `User.organizationId String @default(dbgenerated())` — **NOT NULL**, with
`User_organizationId_fkey` to `Organization(id)`. The default is supplied per transaction by
`tenantScopeExtension`, never by hand. `@@unique([organizationId, email])` means the same
email in two offices is two different users.

**RLS:** `CREATE POLICY "tenant_isolation" ON "User" USING ("organizationId" =
current_setting('app.current_org_id', true)) WITH CHECK (same)`
(`20260928100000_row_level_security:669`). Even if a NULL-org row existed, it would match no
policy and be invisible to the runtime role — and `WITH CHECK` means it could not be
inserted.

There is also **no Organization type**. `Organization` carries `legalName`, `legalNameAr`,
`brokerLicenseNumber`, `subdomain`, `status` (`ACTIVE | SUSPENDED | DEACTIVATED`) — it models
a **broker office**. Nothing distinguishes a broker org from an insurer org.

### Is there any model, role, permission or route for an insurer-side user today?

**Zero.** Measured across `apps/` for `Brokerage Gate`, `insurer portal`, `insurerPortal`,
`InsurerUser`, `insurer-user`, `insurer login`, `gate.insurer`: **0 matches in 0 files.**

- **Model:** `Insurer` is a **data record owned by one office** — it carries
  `organizationId` and has RLS. It is not a principal. The same insurance company
  registered by three offices is **three `Insurer` rows**.
- **Role:** the 12 seeded roles are all broker-office functions.
- **Permission:** no code among the 219 names an insurer-side actor. The ten
  insurer-related codes — `insurer.read`, `insurer.create`, `insurer.update`,
  `insurer.deactivate`, `insurer.directory.read`, `insurer.master.read`,
  `insurer.form.map`, `insurer.office-form.map`, `insurer-accounting.read`,
  `insurer-performance.view` — are **all rights a broker office holds over insurer
  records**, every one granted to a broker-office role. (`insurer.relationship.manage`,
  named in older notes, **does not exist in the grid**; it was split into
  `insurer.create`/`.update`/`.deactivate`.)
- **Route:** no controller serves an insurer principal. `RegistrationType` is
  `DEFAULT | WINDOWS`; `AuthProvider` is `LOCAL | SSO`. No insurer kind.

### Which tables would an insurer user need to read across organizations, and what forbids it?

Per the Gate document's 13 tasks (receive request → initial validation → underwriting →
quote → approve/send → await decision → receive selection → pre-issuance checks → issue →
send policy → financial posting → close), an insurer principal would need to read, **across
every broker office that sends it business**:

| Needed for | Tables |
|---|---|
| The request and its shortlist | `RFQ`, `RFQInsurer`, `Opportunity` |
| The risk and the client | `Customer`, `UltimateBeneficialOwner`, `RiskProfile`, `Asset`, `InsuredPerson`, `NeedsAssessment`, `InsuranceProgram`, `InsuranceProgramLine` |
| Attachments | `Document`, `ClaimDocument` |
| Its own quotes and their versions | `Quotation` |
| The selection | `ClientDecision`, `Recommendation` |
| Issuance | `Policy`, `PolicySchedule` |
| The financial leg | `Invoice`, `Receipt`, `Remittance`, `CommissionLedgerEntry` |
| Correspondence and clocks | `CommunicationLog`, `SlaTimer` |
| Its own audit trail | `AuditLogEntry` |

**Every one of those carries `organizationId` and is one of the 130 tables with
`tenant_isolation` enabled and a policy.** What forbids a cross-office read, named exactly:

1. **The `tenant_isolation` policy on each table** — `USING ("organizationId" =
   current_setting('app.current_org_id', true))`, with `WITH CHECK` mirroring it for writes.
   One policy name, 130 tables.
2. **`app.current_org_id` is set per transaction** by
   `apps/api/src/prisma/tenant-scope.extension.ts` (`SET LOCAL`, transaction-scoped because
   on a pool a bare `SET` and its query can land on two connections), **from the
   authenticated user's single `organizationId`**. A principal has exactly one office, so
   there is no value to set for "all offices that sent me business".
3. **The policies fail closed**, so an insurer session that set no org id would read
   **nothing**, not everything.
4. **The 10 composite foreign keys** listed in § 3.B make a cross-office *reference*
   unrepresentable even when an id is named — not merely filtered.
5. **`Insurer` itself is office-scoped**, so an insurer principal has no single row to be
   recognised as. The only existing identity for one company **across** offices is the
   directory key `COALESCE(insurerMasterId, canonicalName, 'unkeyed:' || id)`.

**The one existing cross-organization read path, as precedent:** `InsurerDirectory`, a view
created `WITH (security_invoker = false)` so it runs with its owner's privileges and is not
subject to `Insurer`'s RLS policy. Its migration states the design rule it was chosen for —
a filtered query needs a `select` clause to stay correct forever, while *"a view has no
relationship columns to leak"*. It returns company-level facts only and discards every
office-scoped column (no credit terms, no commission, no financial-strength rating, no count
of offices, no registration dates), because **the offices on this platform are competing
brokerages**.

**The distance, stated as a measurement:** every table an insurer would read is protected by
one named policy repeated 130 times, fed from a single-office session variable, backed by 10
composite keys; a user cannot exist outside an office; an insurance company has no
cross-office identity other than a directory grouping key; and the only precedent for a
legitimate cross-office read is a SECURITY DEFINER view that exists precisely to strip
office-scoped data out. **No part of the Gate exists, and nothing in the current isolation
design is an accident that could simply be relaxed.**

---

# PART FOUR — The walkthrough

One continuous account, following the broker document's own sequence
(`تطوير إجراء عمل التأمين.pdf` §§ 4–18). Each step says what it does, how it is built, what
happens when it goes wrong, and which of the five states it is in.

### Step 1 — Register the customer (§ 4)

A Sales/Relationship Officer opens `/customers`, clicks through to `/customers/new`, and
chooses one of two forms: a short individual form or a full corporate one. The system
assigns the id; the document's "Customer Number" is a uuid, not a readable number. Entering
a name that already exists in the office does not silently proceed and does not silently
block: the create screen asks *"a customer with this name already exists — is this the same
person?"*, and **the answer is recorded either way** in `DuplicateNameWarning`, carrying the
match count the officer actually saw, their answer, and a nullable `createdCustomerId` —
null meaning they abandoned the create, which is the outcome the warning exists to produce.
The warning **replaces** the submit button rather than sitting beside it, because a warning
next to a live *Create customer* can be clicked past. Two real people share a name, so this
layer deliberately does not prevent.
**State: `WALKABLE`.**

### Step 1a — Loading an existing back-book

An office with thousands of existing customers maps a spreadsheet at
`/settings/customer-import`. The rows import, duplicates are refused and counted, and a
`LegacyImportBatch` with its issues is persisted as the durable report.
**Then the result panel throws and the screen goes blank** — § 5.1. And nothing reads the
persisted batch — § 5.2.
**State: the import itself `WALKABLE` up to the moment it succeeds; the result panel and the
report `ENDPOINT_ONLY`.**

### Step 2 — KYC, UBOs, screening, approval (§ 4.1 "KYC data when needed")

The officer captures the KYC file and uploads documents; a corporate customer's ultimate
beneficial owners go on with ownership percentages and a PEP flag. Screening runs at intake,
on material change, and on a recurring batch (`@Cron`), against roughly 19,000 sanctions
entries, sending name, entity type, date of birth and nationality. A high-risk result opens
the EDD path with its own longer SLA. A Compliance Officer approves in `/customers/kyc-queue`
and **cannot be the person who captured it** — `KYCRecord_maker_checker_distinct` refuses
that in the database, not in a service. The customer does not become ACTIVE before approval.
A match goes to `/screening-matches`, where it must be assigned and put under review before
it can be decided.
**State: `WALKABLE`.**
*Not configurable, against و١٢: which determinants are matched on is fixed in code and the
thresholds are environment variables — § 4.16.*

### Step 3 — Determine the insurance need (§ 5)

`/needs-assessments/new` captures a structured questionnaire that turns "what risks do you
face" into a recommended coverage list; `/risk-profiles` captures the survey that derives
Sum Insured and indemnity period, repeated per location. Both go through review and
approval, and `NeedsAssessment` carries **two** maker/checker pairs — reviewer and approver
— on separate columns, so a declared combined *review* cannot excuse a self-*approval*.
A risk file can be opened before the site is visited, which و١٥ names as the exception
rather than the rule.
**State: `WALKABLE`.**

### Step 4 — Create the insurance request (§ 6)

An `Opportunity` is created from a FINALIZED insurance programme, and an `RFQ` is created
per insurance line at `/rfqs/new`. The document's `Request No.: BR-2026-000125` **does not
exist** — there is no reference-number field on `Opportunity`, `RFQ` or `RFQInsurer`, and the
document's two-level Master Request / Quote Request hierarchy is three levels here
(§ 4.1). The document's `Draft → Submitted` pair maps onto `OpportunityStatus` moving through
`transition()`, which validates the edge, writes the `TRANSITION` audit row in the same
transaction, and refuses an invalid move by naming the allowed next states.
**State: `WALKABLE` for the request; the numbering `NOT_STARTED`.**

### Step 5 — Choose the insurers (§ 7)

The officer picks a shortlist on `/rfqs/[id]`, and one `RFQInsurer` row is written per
insurer, unique on `(rfqId, insurerId)`. An insurer the office has registered itself —
not in any global catalogue — is available, because `Insurer` is office-scoped. The office
can also look at `/insurer-directory` to see which companies other offices have registered
and which lines they write, without learning which office deals with whom.
**State: `WALKABLE`.**
*Not present: the per-insurer quote-request number `BR-2026-000125-C01` (§ 4.1).*

### Step 6 — Send the quote request (§ 8)

Each insurer's status is tracked (`SENT | VIEWED | QUOTED | DECLINED | NO_RESPONSE`), and a
nightly sweep (`@Cron('0 6 * * *')`) raises a follow-up alert once
`RFQ.followUpThresholdDays` is exceeded. Queries and extra information are recorded as
`CommunicationLog`.
**State: `WALKABLE`.**

**The electronic transmission does not exist today.** The document sends the request through
each insurer's Brokerage Gate. In the system the status is **updated by a broker-side
officer** — there is no outbound channel to an insurer system and no insurer principal to
receive it (§ 4.19). **This step does not exist today** in the form § 8 describes.

### Steps 7–9 — The insurer's side (§§ 9–11, and the whole Gate document)

Receive the request, validate it, refer it to an underwriter, decide
(accept / accept with conditions / request information / decline), price it, approve the
quote and send it. **This step does not exist today.** None of the Gate document's 13 tasks,
12 tables or 10 states is built; there is no insurer user, no insurer organization type, and
no route serving an insurer principal. Measured in § 4.19 as a distance, not a plan.

What *does* exist on the broker side is the receiving end: a `Quotation` is captured at
`/rfqs/[id]` by a broker officer, with premium, deductible, limits, BI period, liability
limit, exclusions and conditions. **A zero premium is refused here** —
*"a quotation with no premium is not a quote"*. Every renegotiation round creates a new
version through `previousVersionId`/`isCurrentVersion`; nothing is overwritten.
**State: `WALKABLE` (broker-side capture).**

### Step 10 — Compare the offers (§ 12)

`/opportunities/[id]` builds a comparison matrix automatically from every current-version
quotation — price, coverage, exclusions, deductibles, limits, insurer quality, service — and
**flags the insurers that did not respond**, which the document requires. A bilingual
quotation-comparison document can be generated as a PDF.
**State: `WALKABLE`.**

### Step 11 — Recommend, and disclose a conflict (§ 12 → § 13)

The broker drafts a recommendation with documented rationale. Above a configurable premium
threshold it needs approval from **someone other than the drafter** —
`Recommendation_maker_checker_distinct`, in the database. If a materially
higher-commission insurer is recommended over a comparable offer, a conflict-of-interest
disclosure is detected and required **before** the recommendation can be sent.
**State: `WALKABLE`.**

### Step 12 — Select the insurer (§ 13)

The client's decision is captured as one of six types and routed onward. The chosen insurer
proceeds to placement.

**The other half of § 13 does not exist today.** When one insurer is selected, **nothing is
sent to the others and nothing is recorded against them** — no notification kind, no
`NOT_SELECTED` status, and zero references to `RFQInsurer` in the decision, recommendation
or policy services. A passed-over insurer's row stays at `QUOTED` permanently (§ 4.2).
**State: selection `WALKABLE`; non-selection `NOT_STARTED`.**

### Steps 13–14 — Request issuance, and issue (§§ 14–15)

A `Policy` is created from the accepted opportunity with its inception date
(`policy.create`), then issuance is recorded with the insurer's policy number, premium and
the first `PolicySchedule` (`policy.issue`). `Policy_opportunityId_key` is one policy per
opportunity; `Policy_organizationId_policyNumber_key` refuses a duplicate number inside the
office. **The four-part duplicate check § 22.7 requires — number + insurer + customer +
period — does not exist** (§ 4.10). **A zero issued premium is accepted**; only a negative
one is refused (§ 4.11).
**State: `WALKABLE`.**

### Step 15 — Receive and check the policy (§ 16, and backlog #20)

The schedule is recorded and compared line by line against what was requested — limits, sums
insured, named perils, extensions. The checker **cannot be the person who placed it**
(`PolicyChecking_maker_checker_distinct`). On a discrepancy the record goes to
`DISCREPANCY`, **progression to Delivery is blocked**, and a Professional Indemnity risk
event is logged automatically, because a broker's own error is a PI exposure.
**State: `WALKABLE`.**

### Step 16 — Deliver it (backlog #21)

Date, method, recipient and acknowledgement are recorded. A bilingual policy schedule
summary and a certificate of insurance can be generated — and the certificate **refuses** to
generate for a CANCELLED or EXPIRED policy, because that document is handed to a third party
as proof of live cover.
**State: `WALKABLE`.**

### Step 17 — Register it against the customer, and bill (§§ 17–18)

Here the account diverges from the document in three ways at once, and all three are
measured above.

**Where the work happens.** و١ describes entering the customer, opening their policies, and
performing the finance operations inside one policy. In the system all seven operations are
on **`/opportunities/[id]`** — `/policies/[id]` carries no finance at all (§ 4.5).

**Who can do it.** The **Finance Officer cannot open that screen.** They hold
`invoice.create`, `receipt.record`, `remittance.record`, `refund.approve`,
`refund.disburse` and `claim.settle.second-approve`, and hold none of `opportunity.read`,
`policy.read` or `claim.read` — so the nav entry is hidden and typing the URL returns 403.
They can reach only the read-only reports. **Measured as a class: 14 (permission, holder)
pairs across 12 process/code combinations** (§ 4.5).

**What is recorded.** The document charges the customer 170, owes the insurer 150, and names
20 as brokerage revenue. The system computes
`totalAmount = premium + tax + fees − commissionDeducted` — the customer is billed **net**
of the broker's commission — and `Remittance.amount = premium − commissionDeducted`, which
is the *"remit 880"* the broker explicitly forbade. The same net figure is the broker's own
side of the bank reconciliation. The backlog's #31 line says "net of commission", so the
code follows the backlog and the backlog disagrees with the broker. **Both named, neither
picked** (§ 4.6).

Commission itself is resolved **as of the policy's inception date**, so a later rate change
does not reach an issued policy (§ 4.7) — which does match و٤.
**State: `WALKABLE` for a role that can reach the screen; unusable by the role that holds
the permissions.**

### Step 18 — The accounting entry (§§ 18–19)

**This step does not exist today.** There is no general ledger, no journal, no posting, no
chart of accounts, and therefore no balanced entry and nothing that could enforce
`Debit = Credit` (§ 4.8). The two financial ledger models are single-sided:
`ClientFundsLedgerEntry` (`amount` + `direction` in|out) and `CommissionLedgerEntry`. The
broker's margin **is** identified as commission, with its rate, its VAT and its governing
agreement — so it is not an untyped difference — but the three-leg entry the documents draw
(Customer Receivable 170 → Insurer Payable 150 + Brokerage Revenue 20) has no
representation, and the Master Data definition both documents explicitly demand does not
exist (§ 4.9).

### Step 19 — Collect, remit, and reconcile (backlog #32, #39)

An invoice may be settled in instalments; only the receipt completing it moves the invoice
on. Remittance to the insurer hangs off the first receipt. The three-way comparison raises a
`ReconciliationException` on **any** non-zero variance and never writes a difference off
silently — which matches و٦ exactly: *"الفرق لا يُشطب بصمت أبداً"*.

**What cannot be done:** record a postdated cheque. `cheque` is a method label; `Receipt`
records `receivedAt`, never a future due date; there is no cheque number or bank field, no
due-date report, and no notification kind for one (§ 4.12). The follow-up list ع٣ describes
cannot be produced.
**State: collection and reconciliation `WALKABLE`; postdated cheques `NOT_STARTED`.**

### Step 20 — Endorse, cancel, refund (backlog #22)

A positive or negative endorsement computes the premium adjustment and writes a **new**
policy-schedule version. A cancellation computes the return premium on a short-period or
pro-rata basis. The commission reversal is tied 1:1 to the same premium adjustment
automatically. A refund needs a second approver (`Refund_maker_checker_distinct`), and
`Endorsement_one_live_cancellation_per_policy` — a partial unique index that **excludes
discarded rows**, so withdrawing a wrongly raised cancellation does not block every future
cancellation of that policy. A record raised in error can be withdrawn with a mandatory
ten-character reason without being committed first, and a discarded record leaves every
derived view while staying in its own register.
**State: `WALKABLE`, except that `refund.approve` and `refund.disburse` are held only by
FINANCE, who cannot reach the screen (§ 4.5).**

### Step 21 — Claims (backlog #23–30)

A claim is notified with loss date, location, cause and estimated amount, and cover is
validated **at the exact loss date** against `PolicySchedule.effectiveFrom/effectiveTo` —
not against the current schedule. Registration assigns a loss adjuster; documentation
enforces a mandatory checklist per claim type; assessment logs every status change in its
own record. Settlement always carries four distinct figures — estimated, approved,
deductible, net — never collapsed, and a large claim needs a second approver in the
database.

**Insurer non-response** is detected by a nightly sweep raising `ClaimFollowUpAlert`, not by
a claim status: there is no `ClaimStatus` value for "did not answer in time" (§ 4.4), and the
document the owner remembered naming one is not on this machine.

Closure is formal, after the client's receipt of payment is confirmed, and triggers a loss
ratio recompute.
**State: `WALKABLE`, except `claim.settle.second-approve` — FINANCE holds it and cannot
reach `/claims/[id]` (§ 4.5).**

### Step 22 — Renewal, and the last thing a broker does

A nightly sweep (`@Cron('0 5 * * *')`) opens a renewal case ahead of expiry; the lead time is
configurable. و٢٠ says the window is a variable per office — contacting a month ahead, or a
week, or ten days — and `RenewalCase` moves through `transition()`. Retention cases open
automatically on renewal inactivity or lapse risk. Cross-sell and up-sell sweeps flag gaps
nightly. Every act along the whole path, from the first customer record to the last
settlement, has written an `AuditLogEntry` that cannot be updated or deleted — two database
triggers refuse it, a later migration asserts both still exist, and a third refuses to deploy
if the runtime role is a superuser who could turn them off.
**State: `WALKABLE`.**

---

# 5. Still open

Carried forward and re-verified against today's tree. Nothing here was fixed.

## 5.1 The import screen breaks after a successful import

**Confirmed.** `apps/web/app/(app)/settings/customer-import/page.tsx:221` evaluates
`result.rejections.length + result.failures.length`, and `:235` spreads
`[...result.rejections, ...result.failures]`.

The API no longer returns either field. `apps/api/src/modules/customer/legacy-import.config.ts:264–283`
returns `batchId`, `refusedDuplicates`, `issues: LegacyImportIssueView[]`, and its own
comment at `:267` says: *"`rejections` and `failures` are GONE, replaced by one `issues` list
carrying a `kind`."*

The web still declares the old shape — `apps/web/lib/customer/legacy-import-api.ts:64` and
`:66` — so both properties are `undefined` at runtime and `.length` on `undefined` throws
during render. The rows import; the panel that reports the outcome dies.

**TypeScript cannot see it** because the web declares its own interface over an HTTP
response. This is the same drift class a parity guard was built for in the same pass that
introduced it.

## 5.2 The durable import report has no screen

**Confirmed.** `GET /imports/customers/batches` and `GET /imports/customers/batches/:id`
(`apps/api/src/modules/customer/legacy-import.controller.ts:49` and `:55`, both gated on
`customer.bulk-import`) appear in the path-only unreachable pass: **no web code addresses
either path**. `batchId`, `refusedDuplicates` and the DUPLICATE-vs-BAD_DATA separation all
work over real HTTP and nothing reachable by clicking reads them.
**State: `ENDPOINT_ONLY`.**

## 5.3 The contradiction in the two fixture measurements — resolved

Earlier reporting said a corporate row's nationality and a malformed email were both
**refused**. A later measurement said one is **silently dropped** and the other **not
validated at all**. The second is correct, and the mechanisms are *different*. Here is
exactly what was in each file and exactly what happens to it.

**`docs/walkthrough/import-with-known-defects.csv` — 6 data rows**
(`Client Name,Kind,Reg,Nationality,Email,Phone,Address,Legacy Ref`):

| Line | Row | What it tests | Outcome |
|---|---|---|---|
| 2 | `شركة النهضة للمقاولات`, CORPORATE, no Reg, no email | a corporate row with nothing but a name | written |
| 3 | `سامر عدنان الحلبي`, **INDIVIDUAL**, `Nationality=Jordan` | a non-ISO nationality on a **person** | **REFUSED**, with the ISO rule's own message |
| 4 | `شركة الوفاق التجارية`, **CORPORATE**, `Nationality=JO` | nationality on a **company** | **SILENTLY DROPPED** |
| 5 | `شركة البيان للاستشارات`, CORPORATE, `Email=not-an-email` | a malformed email | **WRITTEN UNVALIDATED** |
| 6 | `شركة الياسمين المكرّرة`, CORPORATE, `REG-1789328001238-27` | a duplicate registration number | outcome is office-dependent by nature |
| 7 | `شركة الصفا للتوريدات`, CORPORATE, valid email + phone | the clean control row | written |

**`docs/walkthrough/import-all-valid.csv` — 3 rows**, all CORPORATE with a registration
number, a valid email, a phone and an address, no nationality. All written.

**Why the three outcomes differ — the mechanism, not a restatement.**
`validateLegacyRow` (`legacy-import.validation.ts:133`) builds a `CreateCustomerDto` from
`legacyRowAsDto(row)`, validates it, and **filters out** any error whose property is in
`LEGACY_IMPORT_UNVALIDATABLE_FIELDS`.

- **Line 3 is refused** because `legacyRowAsDto`'s INDIVIDUAL branch (`:103–114`) **includes**
  `nationality: row.nationality`, so the ISO-2 validator sees `"Jordan"` and rejects it.
- **Line 4 is silently dropped** because the CORPORATE branch (`:116–124`) builds
  `{customerType, legalName, registrationNumber, registeredAddress, languagePreference}` —
  **`nationality` is not in the object at all.** It never reaches the DTO, so
  `CustomerTypeFieldCoherence` — which *does* refuse nationality on a corporate body on the
  single-customer route — never sees it. **No issue is raised and the record is created
  without the value.**
- **Line 5 is written unvalidated** because `contactEmail` is in
  `LEGACY_IMPORT_UNVALIDATABLE_FIELDS = ['nationalId', 'contactPhone', 'contactEmail',
  'natureOfBusiness', 'registeredAddress']` (`:81–87`), so any error on it is filtered out —
  and `legacy-import.service.ts:267–268` then writes
  `contactPhoneEnc: row.contactPhone, contactEmailEnc: row.contactEmail` directly. So
  `not-an-email` is **encrypted and stored as the customer's email address**.

**So, per the question: which personal fields are refused and which are silently dropped.**

| Field | On an INDIVIDUAL row | On a CORPORATE row |
|---|---|---|
| `legalName` | required — **refused** if absent | required — **refused** if absent |
| `customerType` | required — **refused** if absent/invalid | same |
| `nationality` | validated — **refused** if not ISO-2 | **SILENTLY DROPPED** (never enters the DTO) |
| `registrationNumber` | not applicable | validated |
| `contactEmail` | **WRITTEN UNVALIDATED** | **WRITTEN UNVALIDATED** |
| `contactPhone` | **WRITTEN UNVALIDATED** | **WRITTEN UNVALIDATED** |
| `registeredAddress` | **WRITTEN UNVALIDATED** | **WRITTEN UNVALIDATED** |

**Silent dropping is the worse of the two**, as stated: the record is created incomplete and
nobody is told. Writing an unvalidated value is the second — the record is created *wrong*
and nobody is told. Only the refusal path produces an issue the office can act on.

## 5.4 Two typed identifiers remain on `/audit-trail`

**Confirmed, and both are on that screen.**
`python scripts/measurements/typed-identifier-inputs.py` → 102 screens scanned, **14 screens
ask for a typed identifier, 25 inputs, 2 REQUIRED** — and both required ones are
`/audit-trail`: `wfEntityId` at line 406 and `documentId` at line 430. Neither is fixable by
a picker: `wfEntityId` is polymorphic across the 18 workflow entity types, and `documentId`
names a `Document` with no search route.

## 5.5 Office B has no branches

**Could not be measured — Docker was not running, so no row count was taken.** The claim
stands as previously recorded and is unverified today. What *is* verifiable: `Branch` is an
ordinary office-scoped model with RLS, nothing seeds branches for a second office, and the
branch picker on the five screens that filter by branch has nothing to offer an office with
no `Branch` rows.

## 5.6 Two of four sample accounts cannot sign in

**Could not be measured — Docker was not running, so no sign-in was attempted.** Previously
measured by signing in over real HTTP: `sample.compliance` and `sample.manager` return an
MFA challenge whose secret nobody holds, which is the `docs/first-run.md` defect — the seed
enrolled a credential with a secret it generated for its own API calls and never showed
anyone. `mfaEnabled` reports a flag, not whether anybody holds the secret, so this cannot be
answered from the schema.

**`npm run demo:release -w api` was NOT run**, per instruction.

### A narrower repair, described and not run — the owner approves its scope first

`npm run demo:release -w api` exists for exactly this and repairs **all** affected accounts
(previously measured: five of twelve `sample.*` accounts blocked this way, and a sixth
401s). A narrower repair touching only the two named accounts is possible, and here is
precisely what it would have to do:

1. For each of `sample.compliance` and `sample.manager` **only**: delete that user's
   `MfaCredential` rows and set `User.mfaEnabled = false`, `User.mfaMethod = null`,
   `User.mfaEnrolledAt = null`, `User.mfaEnrollmentPending = true`.
2. Nothing else: no password change, no role change, no touching the other ten `sample.*`
   accounts, no `Organization` or grant changes.
3. The effect is that the next sign-in is met by the MFA enrolment banner in the app shell
   and the account pairs a **new** authenticator at `/settings/security`, whose secret the
   owner then holds.
4. It needs a running database, so it cannot be done in this session regardless.

**Two things that would have to be accepted, stated before the fact:** this writes to the
dev database (an audit row per account will be written, which is correct and not
suppressible), and it leaves the other blocked `sample.*` accounts blocked — so if the
owner later needs those, the broader `demo:release` runs anyway. **Not run. Awaiting the
owner's approval of this scope.**

## 5.7 Two defects this audit found, recorded and not fixed

| Defect | Where | Why it matters |
|---|---|---|
| **A measurement script refuses to run on a stale pin** | `scripts/measurements/permission-reachability.py:56` asserts `sum(...) == 491` grants; today's grid holds **502** | The script exits before measuring anything. Its non-vacuity pin is doing its job — it would rather fail than report a clean result from a parse that matched nothing — but the number needs moving to 502 or the guard is simply off. This audit re-did the measurement with the corrected pin |
| **A stale comment states a limitation that no longer exists** | `apps/api/src/modules/customer/screening.service.ts:494` — *"The customer model does not currently capture date of birth, nationality or country, so only names are available today."* | **False.** `Customer.dateOfBirth` and `Customer.nationality` both exist, and `buildScreeningSubjects` sends both. A reader checking whether screening matches on more than a name would conclude it does not. It does |

---

## Appendix — how to re-run the measurements in this document

Nothing here should be quoted from this file later; re-run it.

```bash
# Routes with no web caller — run BOTH, the second finds what the first calls reachable
python scripts/measurements/unreachable-routes.py out.json
python scripts/measurements/unreachable-routes-by-verb.py out2.json

# Hardcoded English on a screen — read the header's six blind spots before trusting a 0
python scripts/measurements/hardcoded-ui-english.py

# Four states per screen; the three counts it prints are WORKLISTS, not violations
python scripts/measurements/four-states.py

# Typed identifiers a person must paste
python scripts/measurements/typed-identifier-inputs.py

# The transition-engine violation guard (fail-on-any, 3 roots)
npx vitest run apps/api/src/modules/workflow/status-writes.inventory.spec.ts

# The two money guards
npx vitest run apps/api/src/common/float-money.inventory.spec.ts
npx vitest run apps/api/src/common/money-fields.inventory.spec.ts

# RLS coverage — note it filters relkind = 'r', so views are excluded
npx vitest run apps/api/test/tenant-isolation.e2e-spec.ts   # needs db-test up
```

Measured directly for this audit, with the command inline so each is reproducible:

```bash
# models / enums / views
grep -cE '^model [A-Za-z]'  packages/db/prisma/schema.prisma   # 139
grep -cE '^enum [A-Za-z]'   packages/db/prisma/schema.prisma   # 62
grep -cE '^view [A-Za-z]'   packages/db/prisma/schema.prisma   # 0

# RLS: enabled vs policied, as distinct table sets
grep -rhoE 'ALTER TABLE "[A-Za-z0-9_]+" ENABLE ROW LEVEL SECURITY' packages/db/prisma/migrations \
  | grep -oE '"[A-Za-z0-9_]+"' | tr -d '"' | sort -u | wc -l        # 130
grep -rhoiE 'CREATE POLICY [^ ]+ ON "[A-Za-z0-9_]+"' packages/db/prisma/migrations \
  | grep -oE 'ON "[A-Za-z0-9_]+"' | grep -oE '"[A-Za-z0-9_]+"' | tr -d '"' | sort -u | wc -l   # 130

# maker/checker: config vs database
grep -oE "dbCheckConstraint: '[A-Za-z0-9_]+'" apps/api/src/common/maker-checker-pairs.config.ts | wc -l   # 15
grep -rhoE 'CONSTRAINT "[A-Za-z0-9_]*maker_checker[A-Za-z0-9_]*"' packages/db/prisma/migrations \
  | sort -u | wc -l                                                  # 15

# permission grid, from the generated fixture (which is read from the seeded database)
head -20 apps/web/e2e/fixtures/role-permissions.ts   # its header states 12 roles, 502 grants

# Decimal precision histogram
grep -oE '@db\.Decimal\([0-9]+, *[0-9]+\)' packages/db/prisma/schema.prisma | sort | uniq -c
#   44 @db.Decimal(18, 3)   15 @db.Decimal(5, 2)   1 @db.Decimal(7, 4)

# cron jobs
grep -rn --include=*.ts "@Cron(" apps/api/src | grep -v spec | grep -oE "name: '[a-z-]+'" | sort -u | wc -l   # 15
```

**Hardcoded Arabic outside the dictionary** has no committed script. Method, so it can be
repeated: scan every `.ts`/`.tsx` under `apps/web` except `apps/web/lib/i18n/**`, `*.spec.*`,
`apps/web/e2e/**` and `apps/web/test/**`; a hit is a line containing a character in
U+0600–U+06FF; then **classify every hit by hand** into unconditional screen copy,
`isArabic ? … : …` branches, and non-screen files. The raw count (37) is not the finding;
the classification is.

**Two host rules that cost time in this session and will cost it again.** Python on this
host cannot be fed a script through a bash heredoc if it contains a backslash escape —
`'\\'` arrived as `'\'` and died as an unterminated string literal, which is the documented
trap; use the `Write` tool for any such script. And Arabic filenames are mangled by the Git
Bash layer (`تطوير إجراء عمل التأمين.pdf` → `?????`), so copy them to ASCII names with
PowerShell, which handles Unicode paths natively, before running `pdftotext`.
