import { Module } from '@nestjs/common';
import { KnowledgeBaseArticleController } from './knowledge-base-article.controller';
import { KnowledgeBaseArticleService } from './knowledge-base-article.service';
import { KnowledgeBaseArticleRepository } from '../../repositories/knowledge-base-article.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 74 (backlog Part C #74, Domain H — the LAST Domain H item).
 * `KnowledgeBaseArticle` pre-exists in the core schema with zero prior
 * application code — this module is its first real consumer, closing out
 * Domain H (Supporting Operations, #66-74).
 *
 * No new permission, no migration — `kb.publish` was already pre-seeded.
 */
@Module({
  imports: [AuditModule],
  controllers: [KnowledgeBaseArticleController],
  providers: [KnowledgeBaseArticleService, KnowledgeBaseArticleRepository],
})
export class KnowledgeBaseArticleModule {}
