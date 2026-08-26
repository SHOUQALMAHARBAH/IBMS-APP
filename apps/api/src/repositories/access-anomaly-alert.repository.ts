import { Injectable } from '@nestjs/common';
import type {
  AccessAnomalyAlert,
  AccessAnomalyPatternType,
  AuditAction,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAccessAnomalyAlertInput {
  userId: string;
  patternType: AccessAnomalyPatternType;
  detailText: string;
  relatedAuditLogEntryIds: string[];
}

@Injectable()
export class AccessAnomalyAlertRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateAccessAnomalyAlertInput): Promise<AccessAnomalyAlert> {
    return this.prisma.client.accessAnomalyAlert.create({ data: input });
  }

  /** Count of AuditLogEntry rows for this user/action since `sinceDate` — used for the
   * bulk-export threshold check. */
  countRecentByUserAndAction(
    userId: string,
    action: AuditAction,
    sinceDate: Date,
  ): Promise<number> {
    return this.prisma.client.auditLogEntry.count({
      where: { userId, action, occurredAt: { gte: sinceDate } },
    });
  }

  /** AuditLogEntry rows flagged isSensitiveDataAccess for this user/entity
   * since `sinceDate` — used for the repeated-unjustified-access threshold
   * check. Not filtered by action: a decrypt (ENCRYPTION_KEY_USED) is as
   * much a sensitive read as a READ action — isSensitiveDataAccess is the
   * field Part 10.3 defines specifically to mark that. */
  findRecentSensitiveReadsByUserAndEntity(
    userId: string,
    entityType: string,
    entityId: string,
    sinceDate: Date,
  ): Promise<{ id: string }[]> {
    return this.prisma.client.auditLogEntry.findMany({
      where: {
        userId,
        entityType,
        entityId,
        isSensitiveDataAccess: true,
        occurredAt: { gte: sinceDate },
      },
      select: { id: true },
    });
  }
}
