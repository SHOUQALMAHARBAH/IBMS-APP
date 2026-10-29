'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
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
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const ROLES = [
  'dpia.review',
];


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
          ? permissionRefusal(t, 'dpiaRefusalAct', 'dpia.review')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dpiaHeading')}
        description={t('dpiaIntro')}
      />

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {canManage ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dpiaSubjectFieldLabel')}
            <input
              aria-label={t('dpiaSubjectLabel')}
              value={subjectDescription}
              onChange={(e) => setSubjectDescription(e.target.value)}
              required
            />
          </label>
          {QUESTIONS.map((q) => (
            <label key={q.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
          <EmptyState title={t('dpiaNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('dpiaColSubject')}</Th>
                  <Th>{t('dpiaColOutcome')}</Th>
                  <Th>{t('dpiaColReviewDue')}</Th>
                  <Th>{t('dpiaColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.subjectDescription}</Td>
                    <Td>{t(ENUM_LABEL.DpiaOutcome[r.outcome])}</Td>
                    <Td>{r.dpoReviewDueAt ? r.dpoReviewDueAt.slice(0, 10) : '—'}</Td>
                    <Td>
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
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dpiaLoading')} />
      )}
    </main>
  );
}
