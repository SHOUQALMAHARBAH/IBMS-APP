import { Injectable } from '@nestjs/common';
import type { ComplianceCalendarItem, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateComplianceCalendarItemInput {
  obligationName: string;
  ownerUserId: string;
  dueDate: Date;
}

export interface ComplianceCalendarScope {
  ownerUserId?: string;
  overdueOnly?: boolean;
}

/**
 * Process 51/Part 7.1 — owns `ComplianceCalendarItem`. Wraps `PrismaService`
 * (services depend on repositories in this codebase, never on Prisma
 * directly).
 */
@Injectable()
export class ComplianceCalendarRepository {
  constructor(private readonly prisma: PrismaService) {}

  userExists(userId: string): Promise<boolean> {
    return this.prisma.client.user
      .count({ where: { id: userId } })
      .then((n) => n > 0);
  }

  create(
    input: CreateComplianceCalendarItemInput,
  ): Promise<ComplianceCalendarItem> {
    return this.prisma.client.complianceCalendarItem.create({
      data: {
        obligationName: input.obligationName,
        ownerUserId: input.ownerUserId,
        dueDate: input.dueDate,
      },
    });
  }

  findById(id: string): Promise<ComplianceCalendarItem | null> {
    return this.prisma.client.complianceCalendarItem.findUnique({
      where: { id },
    });
  }

  findMany(
    scope: ComplianceCalendarScope,
    now: Date,
    take: number,
  ): Promise<ComplianceCalendarItem[]> {
    return this.prisma.client.complianceCalendarItem.findMany({
      where: {
        ...(scope.ownerUserId ? { ownerUserId: scope.ownerUserId } : {}),
        ...(scope.overdueOnly
          ? { submittedAt: null, dueDate: { lt: now } }
          : {}),
      },
      orderBy: { dueDate: 'asc' },
      take,
    });
  }

  /** Write-once submission stamp — status-conditional (`WHERE submittedAt
   * IS NULL`), so a re-submission attempt is a harmless 0-row match, mapped
   * by the service to a 409 rather than silently overwriting the first
   * evidence reference. A recurring obligation is a NEW row for its next
   * cycle (see `compliance-calendar.config.ts`), not a re-stamp of this
   * one. */
  recordSubmission(
    id: string,
    evidenceOfSubmissionRef: string,
    submittedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.complianceCalendarItem.updateMany({
      where: { id, submittedAt: null },
      data: { evidenceOfSubmissionRef, submittedAt },
    });
  }
}
