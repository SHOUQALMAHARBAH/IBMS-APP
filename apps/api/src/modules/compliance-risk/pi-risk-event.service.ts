import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PiRiskEventRepository } from '../../repositories/pi-risk-event.repository';
import { PiPolicyRepository } from '../../repositories/pi-policy.repository';
import { isPiPolicyCurrentlyLapsed } from './pi-policy.config';
import {
  derivePiRiskEventView,
  piRiskEventAuditSnapshot,
  type PiRiskEventView,
} from './pi-risk-event.config';
import type { CreatePiRiskEventDto } from './dto/create-pi-risk-event.dto';
import type { RecordPiRiskEventMitigationDto } from './dto/record-pi-risk-event-mitigation.dto';
import type { ListPiRiskEventsQueryDto } from './dto/list-pi-risk-events-query.dto';

/** Cap on a book-wide `ProfessionalIndemnityRiskEvent` list. */
const PI_RISK_EVENT_READ_LIMIT = 5000;

/**
 * Process 54 — the broker's own Professional Indemnity risk events.
 * `pi-policy.manage` (`[COMPLIANCE_OFFICER]`) is the sole gate — the same
 * permission as the PI policy record itself, since these events exist to
 * track exposure against it. No maker/checker, no workflow status — a
 * factual log, `mitigationAction` the only thing that changes after
 * creation.
 */
@Injectable()
export class PiRiskEventService {
  private readonly logger = new Logger(PiRiskEventService.name);

  constructor(
    private readonly repo: PiRiskEventRepository,
    private readonly policies: PiPolicyRepository,
    private readonly audit: AuditService,
  ) {}

  /** Manual log — an exposure that did not come through a Policy Checking
   * discrepancy (`PolicyCheckingRepository.recordChecking` auto-logs those,
   * Process 20). `sourcePolicyCheckingId` is never set here — only the
   * internal auto-link sets it.
   *
   * A `@code-reviewer` MINOR: auto-resolving to `findCurrent()` when
   * `piPolicyId` is omitted never checked whether that record is itself
   * lapsed — silently linking a fresh exposure to cover that is no longer
   * valid, with no signal anywhere, is exactly the scenario this backlog
   * item frames as a licensing breach. Fixed with a durable signal in TWO
   * places rather than a persisted view field on every future read (which
   * would need either an N+1 lookup or a bulk-fetch on every `list()` call
   * for a fact that is only ever true at the moment of THIS creation): a
   * `logger.warn` for immediate ops visibility, and
   * `linkedPolicyWasLapsedAtLogTime` in the CREATE audit row so the fact
   * survives in the permanent compliance record even after the PI policy is
   * eventually renewed and no longer reads as lapsed. */
  async logManual(
    dto: CreatePiRiskEventDto,
    actorUserId: string,
  ): Promise<PiRiskEventView> {
    let piPolicyId: string | null;
    let linkedPolicyWasLapsedAtLogTime = false;
    if (dto.piPolicyId) {
      const policy = await this.policies.findById(dto.piPolicyId);
      if (!policy) {
        throw new NotFoundException(
          `Professional Indemnity policy ${dto.piPolicyId} not found.`,
        );
      }
      piPolicyId = policy.id;
      linkedPolicyWasLapsedAtLogTime = isPiPolicyCurrentlyLapsed(
        policy,
        new Date(),
      );
    } else {
      const current = await this.policies.findCurrent();
      piPolicyId = current?.id ?? null;
      if (current) {
        linkedPolicyWasLapsedAtLogTime = isPiPolicyCurrentlyLapsed(
          current,
          new Date(),
        );
      }
    }
    if (linkedPolicyWasLapsedAtLogTime) {
      this.logger.warn(
        `PI risk event logged against PI policy ${piPolicyId}, which is currently lapsed.`,
      );
    }

    const row = await this.repo.create({
      piPolicyId,
      description: dto.description,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'ProfessionalIndemnityRiskEvent',
      entityId: row.id,
      afterValue: {
        ...piRiskEventAuditSnapshot(row),
        linkedPolicyWasLapsedAtLogTime,
      },
    });

    return derivePiRiskEventView(row);
  }

  async recordMitigation(
    id: string,
    dto: RecordPiRiskEventMitigationDto,
    actorUserId: string,
  ): Promise<PiRiskEventView> {
    await this.mustFind(id);
    const row = await this.repo.updateMitigation(id, dto.mitigationAction);

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'ProfessionalIndemnityRiskEvent',
      entityId: row.id,
      afterValue: piRiskEventAuditSnapshot(row),
    });

    return derivePiRiskEventView(row);
  }

  async get(id: string): Promise<PiRiskEventView> {
    return derivePiRiskEventView(await this.mustFind(id));
  }

  async list(query: ListPiRiskEventsQueryDto): Promise<PiRiskEventView[]> {
    const rows = await this.repo.findMany(
      {
        piPolicyId: query.piPolicyId,
        sourcePolicyCheckingId: query.sourcePolicyCheckingId,
      },
      PI_RISK_EVENT_READ_LIMIT,
    );
    if (rows.length >= PI_RISK_EVENT_READ_LIMIT) {
      this.logger.warn(
        `PI risk event list truncated at ${PI_RISK_EVENT_READ_LIMIT} rows — narrow with piPolicyId / sourcePolicyCheckingId.`,
      );
    }
    return rows.map(derivePiRiskEventView);
  }

  private async mustFind(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(
        `Professional Indemnity risk event ${id} not found.`,
      );
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `PI-risk-event audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
