import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { KnowledgeBaseArticle } from '@ibms/db';
import { KnowledgeBaseArticleRepository } from '../../repositories/knowledge-base-article.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import type { CreateKnowledgeBaseArticleDto } from './dto/create-knowledge-base-article.dto';
import type { UpdateKnowledgeBaseArticleDto } from './dto/update-knowledge-base-article.dto';
import type { ListKnowledgeBaseArticlesQueryDto } from './dto/list-knowledge-base-articles-query.dto';

/** Process 74 — the foundational `KnowledgeBaseArticle` CRUD, closing out
 * Domain H. See `knowledge-base-article.config.ts` for the full design and
 * `ibms-brain/meta/context/knowledge-management.md`. */
@Injectable()
export class KnowledgeBaseArticleService {
  private readonly logger = new Logger(KnowledgeBaseArticleService.name);

  constructor(
    private readonly articles: KnowledgeBaseArticleRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateKnowledgeBaseArticleDto,
    actorUserId: string,
  ): Promise<KnowledgeBaseArticle> {
    const article = await this.articles.create({
      title: dto.title,
      titleAr: dto.titleAr ?? null,
      category: dto.category,
      bodyEn: dto.bodyEn ?? null,
      bodyAr: dto.bodyAr ?? null,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'KnowledgeBaseArticle',
      entityId: article.id,
      afterValue: { title: article.title, category: article.category },
    });

    return article;
  }

  list(
    query: ListKnowledgeBaseArticlesQueryDto,
  ): Promise<KnowledgeBaseArticle[]> {
    return this.articles.findMany({ category: query.category });
  }

  async get(id: string): Promise<KnowledgeBaseArticle> {
    const article = await this.articles.findById(id);
    if (!article)
      throw new NotFoundException('Knowledge base article not found');
    return article;
  }

  async update(
    id: string,
    dto: UpdateKnowledgeBaseArticleDto,
    actorUserId: string,
  ): Promise<KnowledgeBaseArticle> {
    const existing = await this.articles.findById(id);
    if (!existing)
      throw new NotFoundException('Knowledge base article not found');

    const updated = await this.articles.update(id, {
      title: dto.title,
      titleAr: dto.titleAr,
      category: dto.category,
      bodyEn: dto.bodyEn,
      bodyAr: dto.bodyAr,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'KnowledgeBaseArticle',
      entityId: id,
      afterValue: { title: updated.title, category: updated.category },
    });

    return updated;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `KnowledgeBaseArticle audit (${input.action} ${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
