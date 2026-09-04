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
import { AuditModule } from '../audit/audit.module';
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
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE / REJECT rows)
 *   - SlaModule   -> SlaTimerService (the generic escalation engine —
 *     `service_request_fulfilment` / `complaint_resolution`, both DRAFTED).
 *     `@Global()`, but imported explicitly per the `RbacModule` precedent.
 *
 * `WorkflowTransitionService` (for `Complaint.status`) comes from the
 * `@Global()` `WorkflowModule`, so it is not imported here. The global
 * `PermissionsGuard` / `@CurrentUser` cover all three controllers.
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [
    ServiceRequestController,
    ComplaintController,
    CommunicationController,
  ],
  providers: [
    ServiceRequestService,
    ServiceRequestRepository,
    ComplaintService,
    ComplaintRepository,
    CommunicationService,
    CommunicationRepository,
  ],
})
export class CustomerServiceModule {}
