import { Injectable } from '@nestjs/common';
import type { KnowledgeBaseArticle } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateKnowledgeBaseArticleInput {
  title: string;
  titleAr: string | null;
  category: string;
  bodyEn: string | null;
  bodyAr: string | null;
}

export interface UpdateKnowledgeBaseArticleInput {
  title?: string;
  titleAr?: string;
  category?: string;
  bodyEn?: string;
  bodyAr?: string;
}

export interface KnowledgeBaseArticleFilter {
  category?: string;
}

/**
 * Process 74 (backlog Part C #74, Domain H) — `KnowledgeBaseArticle`
 * pre-exists with zero prior application code. First real writer.
 */
@Injectable()
export class KnowledgeBaseArticleRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateKnowledgeBaseArticleInput,
  ): Promise<KnowledgeBaseArticle> {
    return this.prisma.client.knowledgeBaseArticle.create({ data: input });
  }

  findById(id: string): Promise<KnowledgeBaseArticle | null> {
    return this.prisma.client.knowledgeBaseArticle.findUnique({
      where: { id },
    });
  }

  findMany(
    filter: KnowledgeBaseArticleFilter,
  ): Promise<KnowledgeBaseArticle[]> {
    return this.prisma.client.knowledgeBaseArticle.findMany({
      where: { category: filter.category },
      orderBy: { publishedAt: 'desc' },
    });
  }

  update(
    id: string,
    input: UpdateKnowledgeBaseArticleInput,
  ): Promise<KnowledgeBaseArticle> {
    return this.prisma.client.knowledgeBaseArticle.update({
      where: { id },
      data: input,
    });
  }
}
