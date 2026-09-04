import { Module } from '@nestjs/common';
import { ServiceRequestController } from './service-request.controller';
import { ServiceRequestService } from './service-request.service';
import { ServiceRequestRepository } from '../../repositories/service-request.repository';
import { ComplaintController } from './complaint.controller';
import { ComplaintService } from './complaint.service';
import { ComplaintRepository } from '../../repositories/complaint.repository';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { CommunicationRepository } from '../../repositories/communication.repository';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { FeedbackRepository } from '../../repositories/feedback.repository';
import { RetentionCaseController } from './retention-case.controller';
import { RetentionCaseService } from './retention-case.service';
import { RetentionCaseRepository } from '../../repositories/retention-case.repository';
import { RetentionSweepScheduler } from './retention-sweep.scheduler';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SlaModule } from '../sla/sla.module';

/**
 * Domain E — Customer Service (backlog Part C #41–46).
 *
 *   - Process 41, Customer Requests (`ServiceRequestService`) — logs a
 *     certificate / copy / change request, tracks its fulfilment against an
 *     SLA timer, and moves it `open -> in_progress -> {fulfilled | cancelled}`
 *     (a plain-string status machine, no `WorkflowTransitionService`).
 *   - Process 42, Complaints Management (`ComplaintService`) — logs a customer
 *     complaint (optionally against a disputed claim), moves it through the
 *     `WORKFLOW_TRANSITIONS.Complaint` state machine, tracks it against an SLA
 *     timer, enforces a mandatory supervisor sign-off before closure, and
 *     routes an internally-unresolved complaint to the CBJ Insurance Dispute
 *     Resolution Committee.
 *   - Process 44, Customer Communication (`CommunicationService`) — logs an
 *     outbound customer communication on the `rfqId IS NULL` subset of
 *     `CommunicationLog`, deriving channel / language from the customer record
 *     and gating a marketing send on the customer's MARKETING `ConsentRecord`
 *     (a factual log — no state machine, no maker/checker).
 *   - Process 45, Customer Feedback (`FeedbackService`) — logs a post-issuance
 *     / post-claim / post-renewal satisfaction survey response on
 *     `CustomerFeedback` (a factual log — no state machine, no maker/checker,
 *     no SLA; `comments` is excluded from the audit row, the CRM
 *     `Interaction.summary` precedent).
 *   - Process 46, Customer Retention (`RetentionCaseService` +
 *     `RetentionSweepScheduler`) — closes Domain E. Opens a `RetentionCase`
 *     when a `RenewalCase` (Part 3.9) shows renewal inactivity or lapse risk
 *     (nightly + on-demand), or manually; a factual log, no state machine, no
 *     maker/checker, no SLA. `RenewalCase.status` is never written here —
 *     only the pre-existing `retentionEscalatedAt` timestamp, a status-
 *     conditional stamp that is the race-safe "already escalated" guard.
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE / REJECT rows)
 *   - AuthModule  -> UserRepository (the retention sweep resolves the system
 *     service account, same as the other schedulers)
 *   - SlaModule   -> SlaTimerService (the generic escalation engine —
 *     `service_request_fulfilment` / `complaint_resolution`, both DRAFTED).
 *     `@Global()`, but imported explicitly per the `RbacModule` precedent.
 *
 * `WorkflowTransitionService` (for `Complaint.status`) comes from the
 * `@Global()` `WorkflowModule`, so it is not imported here. The global
 * `PermissionsGuard` / `@CurrentUser` cover all five controllers.
 */
@Module({
  imports: [AuditModule, AuthModule, SlaModule],
  controllers: [
    ServiceRequestController,
    ComplaintController,
    CommunicationController,
    FeedbackController,
    RetentionCaseController,
  ],
  providers: [
    ServiceRequestService,
    ServiceRequestRepository,
    ComplaintService,
    ComplaintRepository,
    CommunicationService,
    CommunicationRepository,
    FeedbackService,
    FeedbackRepository,
    RetentionCaseService,
    RetentionCaseRepository,
    RetentionSweepScheduler,
  ],
})
export class CustomerServiceModule {}
