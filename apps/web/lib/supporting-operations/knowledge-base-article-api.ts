// Process 74 — Knowledge Management (backlog Part C #74, Domain H — the
// last Domain H item). Calls apps/api's /knowledge-base-articles routes.
// kb.publish (already pre-seeded).

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export const KB_CATEGORIES = [
  'product_knowledge',
  'insurer_appetite',
  'rate_guide',
  'regulatory_update',
] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export interface KnowledgeBaseArticle {
  id: string;
  title: string;
  titleAr: string | null;
  category: KbCategory;
  bodyEn: string | null;
  bodyAr: string | null;
  publishedAt: string;
}

export function listKnowledgeBaseArticles(category?: string): Promise<KnowledgeBaseArticle[]> {
  return apiGet(
    category
      ? `/knowledge-base-articles?category=${encodeURIComponent(category)}`
      : '/knowledge-base-articles',
  );
}

export function createKnowledgeBaseArticle(input: {
  title: string;
  titleAr?: string;
  category: KbCategory;
  bodyEn?: string;
  bodyAr?: string;
}): Promise<KnowledgeBaseArticle> {
  return apiPost('/knowledge-base-articles', input);
}

export function updateKnowledgeBaseArticle(
  id: string,
  input: { title?: string; titleAr?: string; category?: KbCategory; bodyEn?: string; bodyAr?: string },
): Promise<KnowledgeBaseArticle> {
  return apiPatch(`/knowledge-base-articles/${id}`, input);
}
