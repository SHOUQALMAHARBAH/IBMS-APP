'use client';

import { useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  FEEDBACK_CONTEXTS,
  createFeedback,
  listFeedback,
  type Feedback,
} from '../../../lib/customer-service/feedback-api';
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
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/** Feedback context values are plain lowercase strings, not a Prisma enum. */
const CONTEXT_LABEL_KEY: Record<string, TranslationKey> = {
  post_issuance: 'fbContextPostIssuance',
  post_claim: 'fbContextPostClaim',
  post_renewal: 'fbContextPostRenewal',
};


export default function FeedbackPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canLog = hasPermission(user, 'feedback.log');

  const [rows, setRows] = useState<Feedback[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [context, setContext] = useState<string>(FEEDBACK_CONTEXTS[0]);
  const [score, setScore] = useState('');
  const [comments, setComments] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listFeedback());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'fbRefusalAct', 'feedback.log')
          : err instanceof ApiError
            ? err.message
            : t('fbLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createFeedback({
        customerId: customerId.trim(),
        context,
        ...(score.trim() ? { score: Number(score) } : {}),
        ...(comments.trim() ? { comments: comments.trim() } : {}),
      });
      setCustomerId('');
      setScore('');
      setComments('');
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('fbSubmitError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('fbHeading')}
        description={t('fbIntro')}
      />

      {canLog ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: 'var(--space-2)',
            maxWidth: '30rem',
          }}
        >
          <EntitySearch
            kind="customer"
            value={customerId}
            onChange={setCustomerId}
            label={t('fbCustomerIdLabel')}
            required
          />
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('fbContextLabel')}
            <select
              aria-label={t('fbContextLabel')}
              value={context}
              onChange={(e) => setContext(e.target.value)}
            >
              {FEEDBACK_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {t(ENUM_LABEL.FeedbackContext[c])}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('fbScoreLabel')}
            <input
              aria-label={t('fbColScore')}
              type="number"
              min={1}
              max={5}
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('fbCommentsLabel')}
            <textarea
              aria-label={t('fbColComments')}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('fbSavingButton') : t('fbLogButton')}
          </button>
        </form>
      ) : null}

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('fbNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('fbColCustomer')}</Th>
                  <Th>{t('fbColContext')}</Th>
                  <Th>{t('fbColScore')}</Th>
                  <Th>{t('fbColComments')}</Th>
                  <Th>{t('fbColSubmitted')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    {/* RULE 2 — the name, never the id. */}
                    <Td>
                      <bdi>{r.customerName}</bdi>
                    </Td>
                    <Td>
                      {CONTEXT_LABEL_KEY[r.context] ? t(CONTEXT_LABEL_KEY[r.context]) : r.context}
                    </Td>
                    <Td>{r.score ?? '—'}</Td>
                    <Td>{r.comments ?? '—'}</Td>
                    <Td>{r.submittedAt.slice(0, 10)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        // Loading only when nothing has failed — otherwise the error and a
        // "Loading…" line render together, which is the state-conflation
        // directive §2 is about. Same guard the complaints page uses.
        <SkeletonList rows={4} label={t('fbLoading')} />
      )}
    </main>
  );
}
