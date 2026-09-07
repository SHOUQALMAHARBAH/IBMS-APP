import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import { FeedbackRepository } from '../../repositories/feedback.repository';
import {
  deriveFeedbackView,
  feedbackAuditSnapshot,
  FEEDBACK_READ_LIMIT,
  type FeedbackView,
} from './feedback.config';
import type { CreateFeedbackDto } from './dto/create-feedback.dto';
import type { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';

/**
 * Process 45 — Customer Feedback (backlog Part C #45, Domain E — Customer
 * Service). Logs a post-issuance / post-claim / post-renewal satisfaction
 * survey response on `CustomerFeedback`.
 *
 * A factual log — no `WorkflowTransitionService`, no maker/checker, no SLA
 * (the `Interaction` #10 shape: create + read only). `feedback.log`
 * (`[SALES_RELATIONSHIP_OFFICER]`) covers both logging and reading — there is
 * no separate read permission (the #41 / #44 shape).
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly repo: FeedbackRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateFeedbackDto,
    actorUserId: string,
  ): Promise<FeedbackView> {
    if (!(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }

    const submittedAt =
      dto.submittedAt !== undefined
        ? parseHistoricalInstant(dto.submittedAt, 'submittedAt')
        : undefined;

    const row = await this.repo.create({
      customerId: dto.customerId,
      context: dto.context,
      score: dto.score ?? null,
      comments: dto.comments ?? null,
      submittedAt,
    });

    // `comments` is deliberately excluded — see feedbackAuditSnapshot's
    // header comment (the CRM Interaction.summary precedent). Best-effort:
    // the feedback is already committed.
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'CustomerFeedback',
      entityId: row.id,
      afterValue: feedbackAuditSnapshot({
        feedbackId: row.id,
        customerId: row.customerId,
        context: row.context,
        score: row.score,
        submittedAt: row.submittedAt,
      }),
    });

    return deriveFeedbackView(row);
  }

  async get(id: string): Promise<FeedbackView> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Feedback ${id} not found.`);
    }
    return deriveFeedbackView(row);
  }

  async list(query: ListFeedbackQueryDto): Promise<FeedbackView[]> {
    const rows = await this.repo.findMany(
      { customerId: query.customerId, context: query.context },
      FEEDBACK_READ_LIMIT,
    );
    if (rows.length >= FEEDBACK_READ_LIMIT) {
      this.logger.warn(
        `Feedback list truncated at ${FEEDBACK_READ_LIMIT} rows — narrow with customerId / context.`,
      );
    }
    return rows.map((r) => deriveFeedbackView(r));
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Feedback audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
