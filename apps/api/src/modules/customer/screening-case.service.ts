import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ScreeningCaseStatus } from '@ibms/db';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserRepository } from '../../repositories/user.repository';
import { canTransitionCase, describeTransition } from './screening-case.config';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Part B §16 — the workflow around a screening match: who owns it, whether
 * anyone has started, whether it was escalated, and the working notes.
 *
 * The DECISION itself stays in `ScreeningMatchService.decide()`. This service
 * moves the case toward a decision and records who did what; it never decides.
 * Keeping them apart is what lets the decision path remain the
 * status-conditional single write it already was.
 *
 * ## Why every mutation is status-conditional
 *
 * Two compliance officers opening the same queue item is an entirely ordinary
 * thing to happen. Every method here writes with the expected current status in
 * the `where`, so the loser gets a clean conflict rather than silently
 * overwriting the winner (`race-safe-invariants.md`).
 */
@Injectable()
export class ScreeningCaseService {
  private readonly logger = new Logger(ScreeningCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  /** Assign, or re-assign, a case to a named reviewer. */
  async assign(
    id: string,
    assigneeUserId: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; caseStatus: ScreeningCaseStatus }> {
    const current = await this.load(id);
    this.assertTransition(current.caseStatus, 'ASSIGNED', id);

    // A case assigned to somebody who cannot act on it is a case that stalls
    // silently. Checked here rather than trusted from the request body.
    const assignee = await this.users.findById(assigneeUserId);
    if (!assignee) {
      throw new BadRequestException(
        `Cannot assign screening case ${id}: user ${assigneeUserId} does not exist.`,
      );
    }
    if (!assignee.isActive) {
      throw new UnprocessableEntityException(
        `Cannot assign screening case ${id}: that user is deactivated.`,
      );
    }

    const updated = await this.conditionalUpdate(id, current.caseStatus, {
      caseStatus: 'ASSIGNED',
      assignedToUserId: assigneeUserId,
      assignedByUserId: actor.id,
      assignedAt: new Date(),
    });

    await this.audit.record({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'ScreeningMatch',
      entityId: id,
      beforeValue: {
        caseStatus: current.caseStatus,
        assignedToUserId: current.assignedToUserId,
      },
      // Identifiers, never the subject's name (sensitive-data-handling.md).
      afterValue: { caseStatus: 'ASSIGNED', assignedToUserId: assigneeUserId },
    });
    return updated;
  }

  /**
   * The assigned reviewer starts work.
   *
   * A separate step from assignment on purpose: it is what distinguishes a case
   * somebody has picked up from one sitting in their queue untouched, which is
   * the difference an SLA is actually about.
   */
  async startReview(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; caseStatus: ScreeningCaseStatus }> {
    const current = await this.load(id);
    this.assertTransition(current.caseStatus, 'UNDER_REVIEW', id);

    if (
      current.assignedToUserId &&
      current.assignedToUserId !== actor.id &&
      current.escalatedToUserId !== actor.id
    ) {
      throw new UnprocessableEntityException(
        `Screening case ${id} is assigned to another reviewer. Re-assign it before starting work, so the queue reflects who is actually on it.`,
      );
    }

    const updated = await this.conditionalUpdate(id, current.caseStatus, {
      caseStatus: 'UNDER_REVIEW',
      reviewStartedAt: new Date(),
      // An escalated case worked directly by its recipient becomes theirs.
      ...(current.assignedToUserId ? {} : { assignedToUserId: actor.id }),
    });

    await this.audit.record({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'ScreeningMatch',
      entityId: id,
      beforeValue: { caseStatus: current.caseStatus },
      afterValue: { caseStatus: 'UNDER_REVIEW' },
    });
    return updated;
  }

  /** Raise the case to somebody else, with a written reason. */
  async escalate(
    id: string,
    toUserId: string,
    reason: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; caseStatus: ScreeningCaseStatus }> {
    const current = await this.load(id);
    this.assertTransition(current.caseStatus, 'ESCALATED', id);

    const target = await this.users.findById(toUserId);
    if (!target || !target.isActive) {
      throw new BadRequestException(
        `Cannot escalate screening case ${id}: the named user does not exist or is deactivated.`,
      );
    }
    if (toUserId === actor.id) {
      // Escalating to yourself records a handover that did not happen.
      throw new UnprocessableEntityException(
        `Cannot escalate screening case ${id} to yourself.`,
      );
    }

    const updated = await this.conditionalUpdate(id, current.caseStatus, {
      caseStatus: 'ESCALATED',
      escalatedToUserId: toUserId,
      escalatedAt: new Date(),
      escalationReason: reason,
    });

    this.logger.warn(
      `Screening case ${id} escalated by ${actor.id} to ${toUserId}.`,
    );
    await this.audit.record({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'ScreeningMatch',
      entityId: id,
      beforeValue: { caseStatus: current.caseStatus },
      // The reason lives on the row. Not duplicated here: it is free text a
      // reviewer writes about a screening finding, so it is a PII capture point
      // by construction — the same convention `reviewReason` already follows.
      afterValue: { caseStatus: 'ESCALATED', escalatedToUserId: toUserId },
    });
    return updated;
  }

  /**
   * Append a working note.
   *
   * Append-only, and allowed in any state except CLOSED. A note that can be
   * edited is not evidence of what the reviewer knew at the time, which is the
   * only reason to keep one.
   */
  async addNote(
    id: string,
    note: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; createdAt: string }> {
    const current = await this.load(id);
    if (current.caseStatus === 'CLOSED') {
      throw new ConflictException(
        `Screening case ${id} is closed. Its record stands as it was when the decision was made; re-screen the customer if the position has changed.`,
      );
    }

    const row = await this.prisma.client.screeningCaseNote.create({
      data: { screeningMatchId: id, note, authorUserId: actor.id },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ScreeningCaseNote',
      entityId: row.id,
      // The note text itself is not copied — see `escalate` above.
      afterValue: { screeningMatchId: id },
    });
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }

  /** The case with its notes, for the reviewer working it. */
  async get(id: string) {
    const row = await this.prisma.client.screeningMatch.findUnique({
      where: { id },
      include: { notes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException(`Screening match ${id} not found.`);
    return row;
  }

  private async load(id: string) {
    const row = await this.prisma.client.screeningMatch.findUnique({
      where: { id },
      select: {
        id: true,
        caseStatus: true,
        assignedToUserId: true,
        escalatedToUserId: true,
        status: true,
      },
    });
    if (!row) throw new NotFoundException(`Screening match ${id} not found.`);
    return row;
  }

  private assertTransition(
    from: ScreeningCaseStatus,
    to: ScreeningCaseStatus,
    id: string,
  ): void {
    if (!canTransitionCase(from, to)) {
      throw new UnprocessableEntityException(
        `Screening case ${id}: ${describeTransition(from, to)}`,
      );
    }
  }

  /** Status-conditional write. 0 rows means somebody else moved the case
   * between our read and our write, which is a conflict, not a silent loss. */
  private async conditionalUpdate(
    id: string,
    expected: ScreeningCaseStatus,
    data: Record<string, unknown>,
  ): Promise<{ id: string; caseStatus: ScreeningCaseStatus }> {
    const { count } = await this.prisma.client.screeningMatch.updateMany({
      where: { id, caseStatus: expected },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        `Screening case ${id} was changed concurrently by another user. Re-read it and try again.`,
      );
    }
    const row = await this.prisma.client.screeningMatch.findUniqueOrThrow({
      where: { id },
      select: { id: true, caseStatus: true },
    });
    return row;
  }
}
