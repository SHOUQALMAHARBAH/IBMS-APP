'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createKnowledgeBaseArticle,
  KB_CATEGORIES,
  listKnowledgeBaseArticles,
  updateKnowledgeBaseArticle,
  type KbCategory,
  type KnowledgeBaseArticle,
} from '../../../lib/supporting-operations/knowledge-base-article-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '32rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };

export default function KnowledgeBasePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [articles, setArticles] = useState<KnowledgeBaseArticle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [category, setCategory] = useState<KbCategory>('product_knowledge');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingTitleAr, setEditingTitleAr] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setArticles(await listKnowledgeBaseArticles());
      setLoadError(null);
    } catch (err) {
      setArticles(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'kbRefusalAct', 'kb.publish')
          : err instanceof ApiError
            ? err.message
            : t('kbLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createKnowledgeBaseArticle({
        title,
        titleAr: titleAr || undefined,
        category,
        bodyEn: bodyEn || undefined,
        bodyAr: bodyAr || undefined,
      });
      setTitle('');
      setTitleAr('');
      setBodyEn('');
      setBodyAr('');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('kbPublishError'));
    }
  }

  function startEdit(article: KnowledgeBaseArticle) {
    setEditingId(article.id);
    setEditingTitle(article.title);
    setEditingTitleAr(article.titleAr ?? '');
  }

  async function saveEdit(id: string) {
    setFormError(null);
    try {
      await updateKnowledgeBaseArticle(id, {
        title: editingTitle,
        titleAr: editingTitleAr || undefined,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('kbUpdateError'));
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('kbHeading')}
        description={t('kbIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>{t('kbPublishSection')}</h2>
        <label style={labelStyle}>
          {t('kbTitleEn')}
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label style={labelStyle}>
          العنوان (Arabic, optional)
          <input dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
        </label>
        <label style={labelStyle}>
          {t('kbColCategory')}
          <select value={category} onChange={(e) => setCategory(e.target.value as KbCategory)}>
            {KB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(ENUM_LABEL.KbCategory[c])}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          {t('kbBodyEn')}
          <textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} rows={4} />
        </label>
        <label style={labelStyle}>
          النص (Arabic, optional)
          <textarea dir="rtl" value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} rows={4} />
        </label>
        {formError ? (
          <ErrorState title={formError} />
        ) : null}
        <button type="submit">{t('kbPublishButton')}</button>
      </form>

      {articles ? (
        articles.length === 0 ? (
          <EmptyState title={t('kbNone')} />
        ) : (
          <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('kbColTitle')}</Th>
                <Th>العنوان</Th>
                <Th>{t('kbColCategory')}</Th>
                <Th>{t('kbColPublished')}</Th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <Tr key={article.id}>
                  <Td>
                    {editingId === article.id ? (
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                      />
                    ) : (
                      article.title
                    )}
                  </Td>
                  {/* `bdi` RATHER THAN `dir="rtl"` ON THE CELL. The column holds an Arabic
                      title inside an otherwise bidirectional table, and a hard `dir` forces every
                      descendant — including a future Latin-script value — right-to-left. `bdi`
                      isolates the run and lets the browser resolve each value's own direction,
                      which is this product's established treatment for a name that may be in
                      either script. */}
                  <Td>
                    {editingId === article.id ? (
                      <input
                        dir="rtl"
                        value={editingTitleAr}
                        onChange={(e) => setEditingTitleAr(e.target.value)}
                      />
                    ) : (
                      <bdi>{article.titleAr ?? '—'}</bdi>
                    )}
                  </Td>
                  <Td>{t(ENUM_LABEL.KbCategory[article.category])}</Td>
                  <Td>{article.publishedAt.slice(0, 10)}</Td>
                  <Td>
                    {editingId === article.id ? (
                      <button type="button" onClick={() => saveEdit(article.id)}>
                        {t('commonSave')}
                      </button>
                    ) : (
                      <button type="button" onClick={() => startEdit(article)}>
                        {t('commonEdit')}
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('kbLoading')} />
      )}

    </main>
  );
}
