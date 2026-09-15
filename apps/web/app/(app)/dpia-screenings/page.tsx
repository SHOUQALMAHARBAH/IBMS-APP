'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createDpiaScreening,
  escalateDpiaToFullDpia,
  listDpiaScreenings,
  recordDpiaReview,
  recordDpiaSpotCheck,
  type DpiaScreening,
} from '../../../lib/pdpl/dpia-screening-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';

const ROLES = [
  'dpia.review',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };


const INITIAL_ANSWERS = {
  qSensitiveData: false,
  qLargeScaleProcessing: false,
  qCrossBorderTransfer: false,
  qNewTechnologyMonitoring: false,
  qNewDigitalChannel: false,
};

// The five screening questions. Module scope has no translator, so each
// carries its label KEY and the component resolves it — the alternative,
// building the list inside the component, would rebuild it every render.
const QUESTIONS: {
  key: keyof typeof INITIAL_ANSWERS;
  labelKey: TranslationKey;
}[] = [
  { key: 'qSensitiveData', labelKey: 'dpiaQSensitive' },
  { key: 'qLargeScaleProcessing', labelKey: 'dpiaQLargeScale' },
  { key: 'qCrossBorderTransfer', labelKey: 'dpiaQCrossBorder' },
  { key: 'qNewTechnologyMonitoring', labelKey: 'dpiaQNewTech' },
  { key: 'qNewDigitalChannel', labelKey: 'dpiaQNewChannel' },
];

export default function DpiaScreeningsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasAnyPermission(user, ROLES);

  const [rows, setRows] = useState<DpiaScreening[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [subjectDescription, setSubjectDescription] = useState('');
  const [answers, setAnswers] = useState(INITIAL_ANSWERS);

  const load = useCallback(async () => {
    try {
      setRows(await listDpiaScreenings());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('dpiaNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('dpiaLoadError'),
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

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('dpiaActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createDpiaScreening({ subjectDescription: subjectDescription.trim(), ...answers });
      setSubjectDescription('');
      setAnswers(INITIAL_ANSWERS);
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('dpiaHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dpiaIntro')}
      </p>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {canManage ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('dpiaSubjectFieldLabel')}
            <input
              aria-label={t('dpiaSubjectLabel')}
              value={subjectDescription}
              onChange={(e) => setSubjectDescription(e.target.value)}
              required
            />
          </label>
          {QUESTIONS.map((q) => (
            <label key={q.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input
                type="checkbox"
                checked={answers[q.key]}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.checked }))}
              />
              {t(q.labelKey)}
            </label>
          ))}
          <button type="submit" disabled={busy}>
            {busy ? t('dpiaSavingButton') : t('dpiaSubmitButton')}
          </button>
        </form>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>{t('dpiaNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('dpiaColSubject')}</th>
                  <th style={head}>{t('dpiaColOutcome')}</th>
                  <th style={head}>{t('dpiaColReviewDue')}</th>
                  <th style={head}>{t('dpiaColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.subjectDescription}</td>
                    <td style={cell}>{r.outcome}</td>
                    <td style={cell}>{r.dpoReviewDueAt ? r.dpoReviewDueAt.slice(0, 10) : '—'}</td>
                    <td style={cell}>
                      {!canManage ? (
                        '—'
                      ) : r.outcome === 'AUTO_APPROVED' && !r.dpoSpotCheckedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => recordDpiaSpotCheck(r.id))}
                        >
                          {t('dpiaSpotCheckButton')}
                        </button>
                      ) : r.outcome === 'DPO_REVIEW_REQUIRED' && !r.dpoReviewedAt ? (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => recordDpiaReview(r.id))}
                          >
                            {t('dpiaRecordReviewButton')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => escalateDpiaToFullDpia(r.id))}
                          >
                            {t('dpiaEscalateButton')}
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>{t('dpiaLoading')}</p>
      )}
    </main>
  );
}
