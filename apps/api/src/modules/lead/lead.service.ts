import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Lead, LeadStatus, RoleName } from '@ibms/db';
import { LeadRepository } from '../../repositories/lead.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateLeadDto } from './dto/create-lead.dto';
import type { ListLeadsQueryDto } from './dto/list-leads-query.dto';

/** Roles the seeded permission grid trusts with cross-owner visibility
 * (packages/db/prisma/seed-data/permissions.ts: `lead.list.read` also
 * grants SALES, but roles-and-segregation-of-duties.md scopes a Sales
 * Officer's own view to their own pipeline — Manager/Executive get the
 * org-wide view). */
const VIEW_ALL_OWNERS_ROLES: RoleName[] = [
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
];

/** Process 1 — Lead Management (backlog Part C, Domain A #1). Every Lead is
 * owned by the Sales/Relationship Officer who created it (the only role
 * `lead.create` is granted to); status only ever moves through
 * WorkflowTransitionService, never a direct field write
 * (ibms-brain/meta/lex/workflow-state-transitions.md). */
@Injectable()
export class LeadService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  async create(dto: CreateLeadDto, actorUserId: string): Promise<Lead> {
    const lead = await this.leads.create({
      fullName: dto.fullName,
      source: dto.source,
      ownerUserId: actorUserId,
      contactPhone: dto.contactPhone,
      contactEmail: dto.contactEmail,
      marketingConsentGranted: dto.marketingConsentGranted,
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Lead',
      entityId: lead.id,
      afterValue: {
        fullName: lead.fullName,
        source: lead.source,
        status: lead.status,
        marketingConsentGranted: lead.marketingConsentGranted,
      },
    });

    return lead;
  }

  /** A Sales/Relationship Officer sees only their own pipeline regardless of
   * what `ownerUserId` they pass — hiding another officer's leads is
   * enforced here, not left to the frontend not offering the filter
   * (verification-contract.md: "Hiding an action in the frontend is not
   * authorization"). Manager/Executive get the org-wide view the grid
   * grants them. */
  list(query: ListLeadsQueryDto, actor: AuthenticatedUser): Promise<Lead[]> {
    const canViewAllOwners = actor.roles.some((role) =>
      VIEW_ALL_OWNERS_ROLES.includes(role),
    );
    return this.leads.findMany({
      source: query.source,
      status: query.status,
      ownerUserId: canViewAllOwners ? query.ownerUserId : actor.id,
    });
  }

  async transition(
    id: string,
    toStatus: LeadStatus,
    actorUserId: string,
  ): Promise<{ id: string; status: string }> {
    const lead = await this.leads.findById(id);
    // Only SALES holds `lead.transition`, and each officer owns their own
    // pipeline — never lets one officer move another's lead through its
    // stages, even though nothing in WorkflowTransitionService itself would
    // stop it. Folded into the same NotFoundException as "doesn't exist"
    // (never ForbiddenException) so the response can't be used as an
    // existence oracle for another officer's lead id — same pattern as
    // auth.service.ts's verifyTotpEnrollment().
    if (!lead || lead.ownerUserId !== actorUserId) {
      throw new NotFoundException('Lead not found');
    }

    // CONVERTED_TO_PROSPECT is the one LeadStatus move that must also create
    // the linked Prospect row (backlog Part C #2) — going through this
    // generic transition endpoint would flip the Lead to a terminal status
    // with no Prospect ever created, since WorkflowTransitionService only
    // knows about `status` columns, not about spawning a sibling entity.
    // POST /prospects (ProspectService.convert) is the only legal path to
    // this particular move; it calls WorkflowTransitionService directly.
    if (toStatus === 'CONVERTED_TO_PROSPECT') {
      throw new UnprocessableEntityException(
        'Convert a Lead to a Prospect via POST /prospects (captures the qualification profile), not this generic transition endpoint.',
      );
    }

    return this.workflow.transition({
      entityType: 'Lead',
      entityId: id,
      toStatus,
      actorUserId,
      // Records the date of actual first contact distinct from createdAt
      // (Lead.firstContactAt defaults to creation time otherwise and would
      // never move) — only meaningful on the one transition that represents
      // first contact; every other move leaves it alone.
      data:
        toStatus === 'CONTACTED' ? { firstContactAt: new Date() } : undefined,
    });
  }
}
