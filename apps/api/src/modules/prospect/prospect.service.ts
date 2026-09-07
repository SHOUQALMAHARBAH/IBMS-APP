import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prospect } from '@ibms/db';
import { ProspectRepository } from '../../repositories/prospect.repository';
import { LeadRepository } from '../../repositories/lead.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { quantizeMoney } from '../../common/money.util';
import { VIEW_ALL_OWNERS_ROLES } from '../../common/rbac-visibility.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateProspectDto } from './dto/create-prospect.dto';
import type { ListProspectsQueryDto } from './dto/list-prospects-query.dto';

/** Process 2 — Prospect Management (backlog Part C, Domain A #2):
 * qualifying a Lead into a Prospect. Ownership carries over from the Lead —
 * a Prospect is owned by whichever Sales/Relationship Officer owned the
 * source Lead, the same officer `prospect.capture` is granted to. */
@Injectable()
export class ProspectService {
  private readonly logger = new Logger(ProspectService.name);

  constructor(
    private readonly prospects: ProspectRepository,
    private readonly leads: LeadRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  /** Converts a Lead into a Prospect: creates the linked Prospect row with
   * the captured qualification profile FIRST, then moves the Lead to
   * LeadStatus.CONVERTED_TO_PROSPECT via WorkflowTransitionService (which
   * also rejects a second conversion attempt, since CONVERTED_TO_PROSPECT is
   * terminal — no separate "already converted" check needed here). This is
   * the ONLY legal path to LeadStatus.CONVERTED_TO_PROSPECT —
   * LeadService.transition() rejects that target directly.
   *
   * Order matters: this codebase has no `$transaction` wrapper spanning two
   * tables (see workflow-transition.service.ts's own note on the same
   * tradeoff), so these two writes cannot be made atomic. Creating the
   * Prospect first means a failure there (a DB constraint, a transient
   * error) leaves the Lead untouched and retriable — the alternative order
   * would leave the Lead permanently stuck in a terminal status with no
   * Prospect and no way to retry, exactly the "converted Lead just...
   * stops" gap this module exists to close. The `status === 'QUALIFIED'`
   * check below is intentionally redundant with what `workflow.transition()`
   * itself validates — it exists so the common "not qualified yet" failure
   * (already covered by real fixed-column DTO validation for most fields)
   * is caught before any Prospect row is written, not just before the Lead
   * is transitioned. */
  async convert(
    dto: CreateProspectDto,
    actorUserId: string,
  ): Promise<Prospect> {
    const lead = await this.leads.findById(dto.leadId);
    // Same ownership-hiding pattern as LeadService.transition(): a
    // NotFoundException either way so the response can't be used as an
    // existence oracle for another officer's lead id.
    if (!lead || lead.ownerUserId !== actorUserId) {
      throw new NotFoundException('Lead not found');
    }
    if (lead.status !== 'QUALIFIED') {
      throw new UnprocessableEntityException(
        `Lead ${dto.leadId}: cannot convert to a Prospect from status ${lead.status} (must be QUALIFIED)`,
      );
    }

    const prospect = await this.prospects.create({
      leadId: dto.leadId,
      companyName: dto.companyName,
      sector: dto.sector,
      activity: dto.activity,
      employeeCount: dto.employeeCount,
      businessSize: dto.businessSize,
      location: dto.location,
      contactPerson: dto.contactPerson,
      productsOfInterest: dto.productsOfInterest ?? [],
      expectedPremium: dto.expectedPremium
        ? quantizeMoney(dto.expectedPremium)
        : undefined,
      salesOwnerUserId: actorUserId,
    });

    await this.workflow.transition({
      entityType: 'Lead',
      entityId: dto.leadId,
      toStatus: 'CONVERTED_TO_PROSPECT',
      actorUserId,
    });

    // Logged, not thrown: the Prospect and the Lead's terminal status are
    // both already durably committed above — an audit-write hiccup here
    // must not turn an already-successful conversion into a reported
    // failure (same philosophy as WorkflowTransitionService's own
    // `sideEffect` catch).
    try {
      await this.audit.record({
        userId: actorUserId,
        action: 'CREATE',
        entityType: 'Prospect',
        entityId: prospect.id,
        afterValue: {
          leadId: prospect.leadId,
          companyName: prospect.companyName,
          status: prospect.status,
        },
      });
    } catch (err) {
      this.logger.error(
        `Prospect ${prospect.id} (Lead ${dto.leadId}): audit record failed after the conversion already committed`,
        err as Error,
      );
    }

    return prospect;
  }

  list(
    query: ListProspectsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Prospect[]> {
    const canViewAllOwners = actor.roles.some((role) =>
      VIEW_ALL_OWNERS_ROLES.includes(role),
    );
    return this.prospects.findMany({
      salesOwnerUserId: canViewAllOwners ? query.salesOwnerUserId : actor.id,
    });
  }

  async get(id: string, actor: AuthenticatedUser): Promise<Prospect> {
    const prospect = await this.prospects.findById(id);
    const canViewAllOwners = actor.roles.some((role) =>
      VIEW_ALL_OWNERS_ROLES.includes(role),
    );
    if (
      !prospect ||
      (!canViewAllOwners && prospect.salesOwnerUserId !== actor.id)
    ) {
      throw new NotFoundException('Prospect not found');
    }
    return prospect;
  }
}
