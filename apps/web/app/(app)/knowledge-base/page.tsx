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
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '32rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

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
          ? t('kbNoPermission')
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
    <main style={pageStyle}>
      <h1>{t('kbHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('kbIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
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
          Category
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
          <p role="alert" style={errorStyle}>
            {formError}
          </p>
        ) : null}
        <button type="submit">{t('kbPublishButton')}</button>
      </form>

      {articles ? (
        articles.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>{t('kbNone')}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('kbColTitle')}</th>
                <th style={head}>العنوان</th>
                <th style={head}>{t('kbColCategory')}</th>
                <th style={head}>{t('kbColPublished')}</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.id}>
                  <td style={cell}>
                    {editingId === article.id ? (
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                      />
                    ) : (
                      article.title
                    )}
                  </td>
                  <td style={cell} dir="rtl">
                    {editingId === article.id ? (
                      <input
                        dir="rtl"
                        value={editingTitleAr}
                        onChange={(e) => setEditingTitleAr(e.target.value)}
                      />
                    ) : (
                      article.titleAr ?? '—'
                    )}
                  </td>
                  <td style={cell}>{t(ENUM_LABEL.KbCategory[article.category])}</td>
                  <td style={cell}>{article.publishedAt.slice(0, 10)}</td>
                  <td style={cell}>
                    {editingId === article.id ? (
                      <button type="button" onClick={() => saveEdit(article.id)}>
                        Save
                      </button>
                    ) : (
                      <button type="button" onClick={() => startEdit(article)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : loadError ? null : (
        <p>{t('kbLoading')}</p>
      )}

    </main>
  );
}
