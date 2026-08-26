import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prospect, RoleName } from '@ibms/db';
import { ProspectRepository } from '../../repositories/prospect.repository';
import { LeadRepository } from '../../repositories/lead.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { quantizeMoney } from '../../common/money.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateProspectDto } from './dto/create-prospect.dto';
import type { ListProspectsQueryDto } from './dto/list-prospects-query.dto';

/** Same cross-owner-visibility roles as LeadService — Sales Officers see
 * only their own prospects, Manager/Executive see the org-wide view
 * (roles-and-segregation-of-duties.md; mirrors lead.service.ts). */
const VIEW_ALL_OWNERS_ROLES: RoleName[] = [
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
];

/** Process 2 — Prospect Management (backlog Part C, Domain A #2):
 * qualifying a Lead into a Prospect. Ownership carries over from the Lead —
 * a Prospect is owned by whichever Sales/Relationship Officer owned the
 * source Lead, the same officer `prospect.capture` is granted to. */
@Injectable()
export class ProspectService {
  constructor(
    private readonly prospects: ProspectRepository,
    private readonly leads: LeadRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  /** Converts a Lead into a Prospect: moves the Lead to
   * LeadStatus.CONVERTED_TO_PROSPECT via WorkflowTransitionService (which
   * rejects the move unless the Lead is currently QUALIFIED, and rejects it
   * a second time since CONVERTED_TO_PROSPECT is terminal — both cases
   * covering "already converted" without a separate check here), then
   * creates the linked Prospect row with the captured qualification
   * profile. This is the ONLY legal path to LeadStatus.CONVERTED_TO_PROSPECT
   * — LeadService.transition() rejects that target directly. */
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

    await this.workflow.transition({
      entityType: 'Lead',
      entityId: dto.leadId,
      toStatus: 'CONVERTED_TO_PROSPECT',
      actorUserId,
    });

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
