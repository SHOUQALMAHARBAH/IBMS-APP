import { Module } from '@nestjs/common';
import { ServiceRequestController } from './service-request.controller';
import { ServiceRequestService } from './service-request.service';
import { ServiceRequestRepository } from '../../repositories/service-request.repository';
import { AuditModule } from '../audit/audit.module';
import { SlaModule } from '../sla/sla.module';

/**
 * Domain E — Customer Service (backlog Part C #41–46). Opens with Process 41,
 * Customer Requests: `ServiceRequestService` logs a customer service request
 * (certificate / copy / change / other), tracks its fulfilment against an SLA
 * timer, and moves it `open -> in_progress -> {fulfilled | cancelled}`.
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE ServiceRequest rows)
 *   - SlaModule   -> SlaTimerService (the generic escalation engine; the
 *     `service_request_fulfilment` workflow — a DRAFTED 5-business-day
 *     default). `@Global()`, but imported explicitly per the
 *     `RbacModule` precedent.
 *
 * `ServiceRequest.status` is a plain string (not a `WorkflowTransitionService`
 * entity), so `WorkflowModule` is not needed. The global `PermissionsGuard` /
 * `@CurrentUser` cover the controller (`service-request.manage` /
 * `[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]`).
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [ServiceRequestController],
  providers: [ServiceRequestService, ServiceRequestRepository],
})
export class CustomerServiceModule {}
