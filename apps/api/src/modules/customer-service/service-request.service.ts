import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { ServiceRequestRepository } from '../../repositories/service-request.repository';
import type { ServiceRequestWithSla } from '../../repositories/service-request.repository';
import {
  deriveServiceRequestView,
  isServiceRequestTransition,
  isTerminalServiceRequestStatus,
  serviceRequestAuditSnapshot,
  serviceRequestUpdateAuditSnapshot,
  SERVICE_REQUEST_READ_LIMIT,
  SERVICE_REQUEST_SLA_WORKFLOW,
  type ServiceRequestStatus,
  type ServiceRequestView,
} from './service-request.config';
import type { CreateServiceRequestDto } from './dto/create-service-request.dto';
import type { CloseServiceRequestDto } from './dto/close-service-request.dto';
import type { ListServiceRequestsQueryDto } from './dto/list-service-requests-query.dto';

/**
 * Process 41 — Customer Requests (backlog Part C #41, Domain E — Customer
 * Service). Logs a customer service request (certificate / copy / change /
 * other), tracks its fulfilment against an SLA timer, and moves it
 * `open -> in_progress -> {fulfilled | cancelled}`.
 *
 * `ServiceRequest.status` is a plain string (the `CommissionLedgerEntry` /
 * `ReconciliationException` pattern) — every move validates against
 * `SERVICE_REQUEST_TRANSITIONS` and persists via a status-conditional
 * `updateMany`. **No maker/checker** (`maker-checker-segregation.md` — a
 * service-desk request is single-actor Sales / Manager work; the backlog line
 * names none). The SLA timer is the generic `SlaTimerService` engine
 * (`service_request_fulfilment` — a DRAFTED 5-business-day default,
 * `sla-registry.config.ts`); it is started **best-effort** at create (a timer
 * failure must not roll back the request — the A.8 / access-recert precedent)
 * and resolved on fulfil / cancel. Book-wide reads. `service-request.manage`
 * (`[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]`).
 */
@Injectable()
export class ServiceRequestService {
  private readonly logger = new Logger(ServiceRequestService.name);

  constructor(
    private readonly repo: ServiceRequestRepository,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. create -----------------------------------------------------

  async create(
    dto: CreateServiceRequestDto,
    actorUserId: string,
  ): Promise<ServiceRequestView> {
    if (!(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }
    if (dto.policyId) {
      const policyCustomer = await this.repo.policyCustomerId(dto.policyId);
      if (policyCustomer === null) {
        throw new NotFoundException(`Policy ${dto.policyId} not found.`);
      }
      if (policyCustomer !== dto.customerId) {
        throw new UnprocessableEntityException(
          `Policy ${dto.policyId} does not belong to customer ${dto.customerId}.`,
        );
      }
    }
    if (
      dto.assignedToUserId &&
      !(await this.repo.userExists(dto.assignedToUserId))
    ) {
      throw new NotFoundException(`User ${dto.assignedToUserId} not found.`);
    }

    const request = await this.repo.create({
      customerId: dto.customerId,
      policyId: dto.policyId ?? null,
      requestType: dto.requestType,
      detail: dto.detail ?? null,
      raisedByUserId: actorUserId,
      assignedToUserId: dto.assignedToUserId ?? null,
    });

    // Best-effort SLA timer — the request is already committed; a timer
    // bookkeeping failure must not hide that it was logged (A.8 / the
    // AccessRecertificationService precedent).
    await this.startSlaTimerBestEffort(request.id, actorUserId);

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'ServiceRequest',
      entityId: request.id,
      afterValue: serviceRequestAuditSnapshot({
        serviceRequestId: request.id,
        customerId: request.customerId,
        policyId: request.policyId,
        requestType: request.requestType,
        detail: request.detail,
        status: request.status,
        assignedToUserId: request.assignedToUserId,
      }),
    });

    return deriveServiceRequestView(await this.load(request.id));
  }

  private async startSlaTimerBestEffort(
    serviceRequestId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      const dueAt = this.slaTimer.computeDueAt(
        SERVICE_REQUEST_SLA_WORKFLOW,
        new Date(),
      );
      const [timer] = await this.slaTimer.startTimer({
        entityType: 'ServiceRequest',
        entityId: serviceRequestId,
        workflowName: SERVICE_REQUEST_SLA_WORKFLOW,
        dueAt,
        actorUserId,
      });
      if (timer) {
        await this.repo.attachSlaTimer(serviceRequestId, timer.id);
      }
    } catch (err) {
      this.logger.warn(
        `ServiceRequest ${serviceRequestId}: failed to start / attach its SLA timer — the request itself was logged: ${(err as Error).message}`,
      );
    }
  }

  // --- 2. assign ---------------------------------------------------

  async assign(
    id: string,
    assignedToUserId: string,
    actorUserId: string,
  ): Promise<ServiceRequestView> {
    const request = await this.load(id);
    if (isTerminalServiceRequestStatus(request.status)) {
      throw new UnprocessableEntityException(
        `Service request ${id} is ${request.status} — it cannot be reassigned.`,
      );
    }
    if (!(await this.repo.userExists(assignedToUserId))) {
      throw new NotFoundException(`User ${assignedToUserId} not found.`);
    }

    const res = await this.repo.recordAssignment(id, assignedToUserId);
    if (res.count === 0) {
      const now = await this.load(id);
      if (isTerminalServiceRequestStatus(now.status)) {
        throw new UnprocessableEntityException(
          `Service request ${id} is ${now.status} — it cannot be reassigned.`,
        );
      }
      throw new ConflictException(
        `Service request ${id} changed concurrently — reload and retry.`,
      );
    }

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveServiceRequestView(after);
  }

  // --- 3. start (open -> in_progress) -----------------------------

  async start(id: string, actorUserId: string): Promise<ServiceRequestView> {
    const request = await this.load(id);
    if (request.status === 'in_progress') {
      return deriveServiceRequestView(request); // idempotent
    }
    // A settled terminal state is a 422 (same as assign / fulfil / cancel), not
    // the 409 `assertTransition` would give — this is not a "reload and retry".
    if (isTerminalServiceRequestStatus(request.status)) {
      throw new UnprocessableEntityException(
        `Service request ${id} is already ${request.status} — it cannot be started.`,
      );
    }
    this.assertTransition(request.status, 'in_progress');

    const res = await this.repo.recordStart(id);
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.status === 'in_progress') return deriveServiceRequestView(now);
      throw new ConflictException(
        `Service request ${id} changed concurrently — reload and retry.`,
      );
    }

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveServiceRequestView(after);
  }

  // --- 4. fulfil / cancel ({open|in_progress} -> terminal) ------

  fulfil(
    id: string,
    dto: CloseServiceRequestDto,
    actorUserId: string,
  ): Promise<ServiceRequestView> {
    // dto.outcomeNote is already @Transform(trimIfString)'d by the DTO.
    return this.close(id, 'fulfilled', dto.outcomeNote, actorUserId);
  }

  cancel(
    id: string,
    dto: CloseServiceRequestDto,
    actorUserId: string,
  ): Promise<ServiceRequestView> {
    return this.close(id, 'cancelled', dto.outcomeNote, actorUserId);
  }

  private async close(
    id: string,
    toStatus: 'fulfilled' | 'cancelled',
    outcomeNote: string,
    actorUserId: string,
  ): Promise<ServiceRequestView> {
    const request = await this.load(id);

    if (request.status === toStatus) {
      if (request.outcomeNote === outcomeNote) {
        return deriveServiceRequestView(request); // idempotent
      }
      throw new ConflictException(
        `Service request ${id} is already ${toStatus} with a different outcome note.`,
      );
    }
    if (isTerminalServiceRequestStatus(request.status)) {
      throw new UnprocessableEntityException(
        `Service request ${id} is already ${request.status}.`,
      );
    }
    this.assertTransition(request.status, toStatus);

    const closedAt = new Date();
    const res = await this.repo.recordClosure(id, {
      toStatus,
      outcomeNote,
      fulfilledByUserId: toStatus === 'fulfilled' ? actorUserId : null,
      closedAt,
    });
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.status === toStatus && now.outcomeNote === outcomeNote) {
        return deriveServiceRequestView(now);
      }
      throw new ConflictException(
        `Service request ${id} changed concurrently — reload and retry.`,
      );
    }

    // Best-effort — the closure is committed; a timer failure self-heals (the
    // sweep just escalates a resolved-in-domain-but-not-in-timer row once, then
    // a later resolve call clears it; harmless for a closed request).
    await this.resolveSlaTimerBestEffort(id, actorUserId);

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveServiceRequestView(after);
  }

  private async resolveSlaTimerBestEffort(
    serviceRequestId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.slaTimer.resolve({
        entityType: 'ServiceRequest',
        entityId: serviceRequestId,
        workflowName: SERVICE_REQUEST_SLA_WORKFLOW,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `ServiceRequest ${serviceRequestId}: failed to resolve its SLA timer on closure (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  // --- reads -----------------------------------------------------

  async get(id: string): Promise<ServiceRequestView> {
    return deriveServiceRequestView(await this.load(id));
  }

  async list(
    query: ListServiceRequestsQueryDto,
  ): Promise<ServiceRequestView[]> {
    const rows = await this.repo.findMany(
      {
        customerId: query.customerId,
        status: query.status,
        assignedToUserId: query.assignedToUserId,
      },
      SERVICE_REQUEST_READ_LIMIT,
    );
    if (rows.length >= SERVICE_REQUEST_READ_LIMIT) {
      this.logger.warn(
        `Service-request list truncated at ${SERVICE_REQUEST_READ_LIMIT} rows — narrow with customerId / status / assignedToUserId.`,
      );
    }
    const now = new Date();
    return rows.map((r) => deriveServiceRequestView(r, now));
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<ServiceRequestWithSla> {
    const request = await this.repo.findById(id);
    if (!request) {
      throw new NotFoundException(`Service request ${id} not found.`);
    }
    return request;
  }

  private assertTransition(from: string, to: ServiceRequestStatus): void {
    if (!isServiceRequestTransition(from, to)) {
      throw new ConflictException(
        `Service request cannot move ${from} -> ${to}.`,
      );
    }
  }

  private async auditUpdate(
    actorUserId: string,
    after: ServiceRequestWithSla,
  ): Promise<void> {
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'ServiceRequest',
      entityId: after.id,
      afterValue: serviceRequestUpdateAuditSnapshot({
        serviceRequestId: after.id,
        customerId: after.customerId,
        status: after.status,
        assignedToUserId: after.assignedToUserId,
        fulfilledByUserId: after.fulfilledByUserId,
        outcomeNote: after.outcomeNote,
        closedAt: after.closedAt,
      }),
    });
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Service-request audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
