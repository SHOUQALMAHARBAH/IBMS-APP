import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { KnowledgeBaseArticleService } from './knowledge-base-article.service';
import type { KnowledgeBaseArticleRepository } from '../../repositories/knowledge-base-article.repository';
import type { AuditService } from '../audit/audit.service';

function baseArticle(over: Record<string, unknown> = {}) {
  return {
    id: 'article-1',
    title: 'Property All Risks — Overview',
    titleAr: null,
    category: 'product_knowledge',
    bodyEn: 'Coverage summary...',
    bodyAr: null,
    publishedAt: new Date('2026-09-06T09:00:00.000Z'),
    ...over,
  };
}

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(baseArticle()),
    findById: vi.fn().mockResolvedValue(baseArticle()),
    findMany: vi.fn().mockResolvedValue([baseArticle()]),
    update: vi
      .fn()
      .mockResolvedValue(baseArticle({ title: 'Renamed Article' })),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new KnowledgeBaseArticleService(
    repo as unknown as KnowledgeBaseArticleRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('KnowledgeBaseArticleService.create', () => {
  it('creates an article (English only) and writes a CREATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.create(
      {
        title: 'Property All Risks — Overview',
        category: 'product_knowledge',
        bodyEn: 'Coverage summary...',
      },
      'actor-1',
    );
    expect(repo.create).toHaveBeenCalledWith({
      title: 'Property All Risks — Overview',
      titleAr: null,
      category: 'product_knowledge',
      bodyEn: 'Coverage summary...',
      bodyAr: null,
    });
    expect(result.id).toBe('article-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'KnowledgeBaseArticle',
      }),
    );
  });

  it('accepts a bilingual article with both English and Arabic content', async () => {
    const { service, repo } = makeService();
    await service.create(
      {
        title: 'Motor Rate Guide',
        titleAr: 'دليل أسعار السيارات',
        category: 'rate_guide',
        bodyEn: 'Rates by class...',
        bodyAr: 'الأسعار حسب الفئة...',
      },
      'actor-1',
    );
    expect(repo.create).toHaveBeenCalledWith({
      title: 'Motor Rate Guide',
      titleAr: 'دليل أسعار السيارات',
      category: 'rate_guide',
      bodyEn: 'Rates by class...',
      bodyAr: 'الأسعار حسب الفئة...',
    });
  });

  it('does not fail the create if the audit write itself fails', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      service.create({ title: 'X', category: 'regulatory_update' }, 'actor-1'),
    ).resolves.toBeDefined();
  });
});

describe('KnowledgeBaseArticleService.list', () => {
  it('passes the optional category filter through', async () => {
    const { service, repo } = makeService();
    await service.list({ category: 'insurer_appetite' });
    expect(repo.findMany).toHaveBeenCalledWith({
      category: 'insurer_appetite',
    });
  });

  it('lists with no filter when none is given', async () => {
    const { service, repo } = makeService();
    await service.list({});
    expect(repo.findMany).toHaveBeenCalledWith({ category: undefined });
  });
});

describe('KnowledgeBaseArticleService.get', () => {
  it('returns the article', async () => {
    const { service } = makeService();
    const article = await service.get('article-1');
    expect(article.id).toBe('article-1');
  });

  it('404s for an unknown article', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('KnowledgeBaseArticleService.update', () => {
  it('updates the article and writes an UPDATE audit row', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.update(
      'article-1',
      { title: 'Renamed Article' },
      'actor-1',
    );
    expect(repo.update).toHaveBeenCalledWith('article-1', {
      title: 'Renamed Article',
      titleAr: undefined,
      category: undefined,
      bodyEn: undefined,
      bodyAr: undefined,
    });
    expect(result.title).toBe('Renamed Article');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'KnowledgeBaseArticle',
      }),
    );
  });

  it('404s updating an unknown article', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.update('nope', { title: 'X' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
