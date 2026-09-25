import { Injectable } from '@nestjs/common';
import type { CombinedDutyAct } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCombinedDutyActInput {
  entity: string;
  entityId: string;
  constraintName: string;
  actorUserId: string;
  reason: string;
  actorRoleIds: string[];
  grantingRoleIds: string[];
  grantingRoleNames: string[];
  multipleGrantingRoles: boolean;
}

/**
 * Declared combined-duty acts — one row per occasion on which one person performed both halves of a
 * maker/checker pair in an office that has declared COMBINED mode.
 *
 * There is no update and no delete. The row is the evidence: an act that could be edited afterwards is not
 * evidence of anything, and `onDelete: Restrict` on all 15 escape columns means the database refuses to
 * remove one that excused a write even if code tried.
 *
 * `organizationId` is supplied by `tenantScopeExtension`, never by hand — and the trigger
 * `combined_duty_act_requires_combined_mode` reads exactly that column, so an act can only be written for an
 * office that has declared the mode. That refusal is a `23514`, deliberately: it is the segregation control
 * firing, not a validation error.
 */
@Injectable()
export class CombinedDutyActRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateCombinedDutyActInput): Promise<CombinedDutyAct> {
    return this.prisma.client.combinedDutyAct.create({ data: input });
  }

  /** The self-approval report's page: this office's declared acts, newest first. */
  findManyForOffice(limit: number): Promise<CombinedDutyAct[]> {
    return this.prisma.client.combinedDutyAct.findMany({
      orderBy: { actedAt: 'desc' },
      take: limit,
    });
  }

  /** What a record screen shows about itself — every act declared against one record. */
  findManyForEntity(
    entity: string,
    entityId: string,
  ): Promise<CombinedDutyAct[]> {
    return this.prisma.client.combinedDutyAct.findMany({
      where: { entity, entityId },
      orderBy: { actedAt: 'desc' },
    });
  }
}
