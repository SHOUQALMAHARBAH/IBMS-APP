import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SecurityModule } from './modules/security/security.module';
import { SlaModule } from './modules/sla/sla.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { LeadModule } from './modules/lead/lead.module';
import { ProspectModule } from './modules/prospect/prospect.module';
import { CustomerModule } from './modules/customer/customer.module';
import { RiskProfileModule } from './modules/risk-profile/risk-profile.module';
import { NeedsAssessmentModule } from './modules/needs-assessment/needs-assessment.module';
import { InsuranceProgramModule } from './modules/insurance-program/insurance-program.module';
import { CrossSellModule } from './modules/cross-sell/cross-sell.module';
import { UpSellModule } from './modules/up-sell/up-sell.module';
import { CrmModule } from './modules/crm/crm.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { QuotationModule } from './modules/quotation/quotation.module';
import { ComparisonModule } from './modules/comparison/comparison.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { ClientDecisionModule } from './modules/client-decision/client-decision.module';
import { PolicyModule } from './modules/policy/policy.module';
import { EndorsementModule } from './modules/endorsement/endorsement.module';
import { LossRatioModule } from './modules/loss-ratio/loss-ratio.module';
import { CustomerServiceModule } from './modules/customer-service/customer-service.module';
import { ClaimModule } from './modules/claim/claim.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CommissionModule } from './modules/commission/commission.module';
import { SlaDashboardModule } from './modules/sla-dashboard/sla-dashboard.module';
import { PdplModule } from './modules/pdpl/pdpl.module';
import { ComplianceRiskModule } from './modules/compliance-risk/compliance-risk.module';

@Module({
  imports: [
    // In Docker/CI, real env vars are already in process.env and these files
    // simply won't exist — ConfigModule does not error when they're missing.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Enables @Cron() discovery anywhere in the app (see
    // rbac/services/access-recertification.scheduler.ts) — registered once,
    // globally, here.
    ScheduleModule.forRoot(),
    // Part 10.3/10.4 — structured operational logging (pino). First so the
    // injectable Logger + HTTP request logging cover every module below.
    // Distinct from AuditModule's immutable AuditLogEntry (the compliance
    // trail); see common/logging/logging.module.ts.
    LoggingModule,
    PrismaModule,
    AuditModule,
    // Depends on AuditModule's global AuditService for the TRANSITION audit
    // row every transition() call writes.
    WorkflowModule,
    AuthModule,
    // Depends on AuthModule's exported UserRepository (system service
    // account lookup for escalation-sweep audit rows) — imported after it.
    SlaModule,
    // Imported after AuthModule — see rbac.module.ts's PermissionsGuard
    // comment for why global-guard execution order depends on this.
    RbacModule,
    SecurityModule,
    // Part C backlog #1 (Lead Management) — the first business (non-
    // infrastructure) module. Depends on WorkflowModule (Lead's status
    // transitions) and RbacModule's PermissionsGuard (lead.create/
    // lead.list.read/lead.transition) already being registered above.
    LeadModule,
    // Part C backlog #2 (Prospect Management) — depends on LeadModule's
    // exported LeadRepository (reads the source Lead before converting it)
    // and WorkflowModule (the Lead's CONVERTED_TO_PROSPECT transition).
    ProspectModule,
    // Part C backlog #3-4 (Customer Acquisition/Onboarding) — depends on
    // ProspectModule's exported ProspectRepository (validates an optional
    // prospectId link), SecurityModule (field encryption/masking, its first
    // real consumer), and WorkflowModule/SlaModule (KYCRecord/Customer
    // status transitions, the two new kyc_*_review SLA timers).
    CustomerModule,
    // Part C backlog #5 (Needs Assessment) — depends on CustomerModule's
    // exported CustomerRepository (a Risk Profile inherits its Customer's
    // visibility). RiskProfileModule is the minimal parent-record home
    // Process 6 (the asset survey) will build on; NeedsAssessmentModule
    // carries the questionnaire + review/approval gate and reuses
    // WorkflowModule for the NeedsAssessment status chain.
    RiskProfileModule,
    NeedsAssessmentModule,
    // Part C backlog #7 (Product Recommendation / Program Design) — assembles
    // an InsuranceProgram from an APPROVED NeedsAssessment's coverage list +
    // the parent RiskProfile's asset survey. Depends on NeedsAssessmentModule
    // /RiskProfileModule/CustomerModule's exported repositories and reuses
    // WorkflowModule for the InsuranceProgram status chain.
    InsuranceProgramModule,
    // Part C backlog #8 (Cross-Selling) — a nightly job + on-demand scan
    // flags each benchmark insurance line a customer holds no in-force
    // policy for, as a CrossSellOpportunity a Sales Officer then converts or
    // dismisses. Depends on CustomerModule (visibility) and AuthModule (the
    // scheduler's system-account lookup); reuses WorkflowModule for the
    // OPEN -> CONVERTED | DISMISSED status chain.
    CrossSellModule,
    // Part C backlog #9 (Up-Selling) — a nightly job + on-demand scan
    // compares a customer's designed property Sum Insured (InsuranceProgram,
    // #7) against the current value of their surveyed assets (RiskProfile,
    // #6) and flags a proposed increase. Depends on InsuranceProgramModule /
    // RiskProfileModule / CustomerModule's exported repositories and
    // AuthModule; reuses WorkflowModule for the OPEN -> CONVERTED |
    // DISMISSED status chain.
    UpSellModule,
    // Part C backlog #10 (Relationship Management / CRM) — logs every
    // customer touchpoint as an Interaction and serves the aggregated 360°
    // customer view (interactions + policies + claims + complaints, merged
    // into one timeline). Depends on CustomerModule (read visibility) and
    // AuditModule (the CREATE row per interaction + the sensitive-data READ
    // row for a 360° view). No workflow / maker-checker — Interaction is a
    // factual log.
    CrmModule,
    // Part C backlog #11 (RFQ / Market Submission) — the first Domain B
    // (Insurance Operations) module. OpportunityModule is the minimal
    // parent-record home (created from a FINALIZED InsuranceProgram, then
    // list/read only — the full Opportunity lifecycle is #16-17); RfqModule
    // creates one RFQ per insurance line, tracks each shortlisted insurer's
    // response status, and runs the nightly follow-up alert sweep. Depends
    // on InsuranceProgramModule / RiskProfileModule / CustomerModule's
    // exported repositories and AuthModule (the scheduler's system-account
    // lookup); reuses WorkflowModule for the Opportunity NEEDS_CONFIRMED ->
    // RFQ_ISSUED and the RFQInsurer response-status transitions.
    OpportunityModule,
    RfqModule,
    // Part C backlog #13 (Quotation Management) — captures an insurer's
    // quote against one RFQ line (premium / deductible / limits / BI period
    // / liability limit / exclusions / conditions) and versions it on every
    // renegotiation via the `previousVersionId` / `isCurrentVersion` chain,
    // never overwriting. Depends on RfqModule's exported RfqRepository (the
    // shortlist) plus OpportunityModule / CustomerModule (visibility) and
    // reuses WorkflowModule for the best-effort RFQInsurer -> QUOTED and
    // Opportunity RFQ_ISSUED -> QUOTES_RECEIVED moves.
    QuotationModule,
    // Part C backlog #14 (Quote Comparison) — (re)assembles a
    // ComparisonMatrix for an RFQ from every current-version Quotation on it
    // (one row each; the objective dimensions live on the linked Quotation),
    // flags the shortlisted insurers with no quote to compare, and
    // optionally carries per-insurer quality/service scores. Depends on
    // QuotationModule's exported QuotationRepository plus RfqModule /
    // OpportunityModule / CustomerModule; reuses WorkflowModule for the
    // best-effort Opportunity QUOTES_RECEIVED -> COMPARISON_BUILT move.
    ComparisonModule,
    // Part C backlog #16 (Broker Recommendation) — drafts the documented
    // recommendation (all six rationale factors), gates it on a
    // senior-officer approval above the Opportunity's configurable
    // targetPremiumThreshold (maker/checker), and detects + requires a
    // conflict-of-interest disclosure when a comparable competing quote
    // carried a materially lower commission rate. Depends on
    // OpportunityModule / QuotationModule / CustomerModule; reuses
    // WorkflowModule for the best-effort Opportunity COMPARISON_BUILT ->
    // RECOMMENDATION_DRAFTED -> SENT_TO_CLIENT moves.
    RecommendationModule,
    // Part C backlog #17 (Client Decision Handling) — captures the client's
    // single decision on a sent recommendation (one ClientDecision per
    // Opportunity) and routes the parent: the six ClientDecisionType values
    // collapse to three Opportunity paths — ACCEPT -> PLACEMENT, REJECT ->
    // CLOSED_LOST, the four REQUEST_* -> RENEGOTIATE (via the engine,
    // SENT_TO_CLIENT -> CLIENT_DECISION -> <route>, best-effort). Depends on
    // OpportunityModule / RecommendationModule / CustomerModule.
    ClientDecisionModule,
    // Part C backlog #18-19 (Policy Placement & Issuance) — creates the
    // Policy from a client-ACCEPTed Opportunity (insurer / line / premium /
    // currency taken from the accepted recommendation's quotation, caller
    // sets the inception date), then records the insurer-issued policy /
    // schedule / documents / premium invoice and drives the Policy
    // PLACEMENT_CONFIRMED -> ISSUED transition through the workflow engine.
    // Depends on OpportunityModule / RecommendationModule /
    // ClientDecisionModule / CustomerModule.
    PolicyModule,
    // Part C backlog #22 (Endorsement Management) — raises and works a
    // positive/negative mid-term endorsement or a cancellation on an ACTIVE
    // Policy: the signed premium adjustment, a NEW (never-overwritten)
    // PolicySchedule version at APPLY, the cancellation short-period/pro-rata
    // return-premium calculation, a maker/checker-gated Refund above a
    // configurable value threshold, and the CommissionReversal tied 1:1
    // automatically to the same premium adjustment. Depends on PolicyModule
    // (the parent Policy + schedule versioning) / RecommendationModule (the
    // placed quotation's commission rate) / CustomerModule; reuses
    // WorkflowModule for the Endorsement status walk and the best-effort
    // Policy ACTIVE -> CANCELLED move.
    EndorsementModule,
    // Part C backlog #23 (Claim Notification) — opens Domain C. Records a
    // reported loss against a Policy (loss date/location/cause, estimated
    // loss, third-party involvement) at ClaimStatus.NOTIFIED, validating that
    // cover was in force at the EXACT loss date against the policy's
    // PolicySchedule version windows (the materialised endorsement history),
    // not the current schedule alone. Depends on PolicyModule (the parent
    // Policy + schedule windows) / CustomerModule (visibility) / SecurityModule
    // (ThirdPartyClaimant.contactDetailsEnc field-level encryption).
    //
    // Part C backlog #29 (Claim Closure) — LossRatioModule recomputes
    // Claims / Premium for a policy's RenewalCase (1:1 with the Policy) when a
    // claim closes (a logged no-op until the renewal module exists). Imported
    // by ClaimModule; listed here for the module registry.
    LossRatioModule,
    ClaimModule,
    // Part C backlog #31-32 (Premium Billing + Collection) — Domain D
    // (Finance). #31 raises the new-business premium Invoice against an issued
    // policy (premium carried from Policy.issuedPremium, commission auto-
    // derived from the placed quotation's rate, tax + fees supplied by
    // Finance, totalAmount computed server-side; one per policy via a partial
    // UNIQUE). #32 drives it through the cycle INVOICED -> COLLECTED ->
    // RECONCILED -> REMITTED via the workflow engine — recording the client's
    // receipt, reconciling the collected funds, remitting the net premium
    // (premium - commission) to the insurer, and booking a
    // ClientFundsLedgerEntry at each money movement (Part 7.3). Depends on
    // PolicyModule (the policy + insurer) / RecommendationModule (the placed
    // commission rate).
    FinanceModule,
    // Part C backlog #35 (Commission Calculation) — the governed
    // CommissionAgreement rate table (by insurer + line, time-windowed;
    // commission-rate.manage / Compliance + Manager) and the
    // CommissionLedgerEntry ledger: calculate at the governed rate
    // (commission.calculate / Finance, write-once per policy) plus the
    // manual-override maker/checker pair (commission-override.raise / Finance
    // -> commission-override.approve / Manager). Depends on PolicyModule.
    CommissionModule,
    // Part C backlog #41 (Customer Requests) — opens Domain E. ServiceRequest
    // (certificate / copy / change / other), a plain-string status machine
    // (open -> in_progress -> {fulfilled | cancelled}), with its fulfilment
    // tracked by the generic SlaTimerService (service_request_fulfilment — a
    // DRAFTED 5-business-day default). service-request.manage / Sales, Manager.
    CustomerServiceModule,
    // Part C backlog #43 (SLA Management, Domain E) — a read-only cross-module
    // monitoring dashboard over the generic SlaTimer engine (GET
    // /sla-dashboard/summary + /timers, sla-dashboard.view / Compliance,
    // Manager, Exec, Auditor). No migration, no seed change; a best-effort READ
    // audit row per read. Separate from SlaModule (the engine + sweep).
    SlaDashboardModule,
    // Part D (PDPL foundations, `IMPROVEMENTS.md` §5.1 / backlog Process #52)
    // — M03 Consent Management: capture a consent decision at a defined
    // touchpoint, withdraw it through a two-step request/confirm flow that
    // gives the generic SlaTimerService (consent_withdrawal, 2 business
    // days) a real window, and feed #44's marketing-send gate (which already
    // reads ConsentRecord) a real write path. consent.manage / Sales,
    // Placement, Claims, DPO. The first of the nine Part D / PCMS systems.
    PdplModule,
    // Part C backlog #48 (AML/CFT Transaction Monitoring, Domain F — opens
    // Compliance & Risk beyond KYC; #47 KYC needed no separate build, fully
    // covered by CustomerModule's #3-4). A nightly + on-demand sweep over
    // Receipt/Cancellation/Refund flags unusually large premium payments,
    // frequent cancellations/refunds, and third-party payment sources as a
    // TransactionMonitoringAlert, plus a two-step escalate ->
    // report-to-authority path. aml.monitor / aml.escalate / Compliance.
    // Also #49 (Sanctions & PEP Screening): syncs two free public sanctions
    // lists (OFAC SDN, UN Consolidated) into WatchlistEntry every 12 hours,
    // which CustomerModule's ScreeningService matches customer/UBO names
    // against on every screening run (real, every environment — unlike the
    // dev/test-only sample-watchlist.ts fixture); ScreeningBatchScheduler's
    // recurring re-screen moved to a 4-hourly cadence to match.
    // sanctions-pep.screen / Compliance.
    ComplianceRiskModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
