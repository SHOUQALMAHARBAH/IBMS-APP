'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  PRIVACY_NOTICE_TOUCHPOINTS,
  createPrivacyNotice,
  listPrivacyNotices,
  recordPrivacyNoticeLegalReview,
  type PrivacyNotice,
} from '../../../lib/pdpl/privacy-notice-api';
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
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const ROLES = [
  'privacy-notice.publish',
];


export default function PrivacyNoticesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasAnyPermission(user, ROLES);

  const [rows, setRows] = useState<PrivacyNotice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [touchpoint, setTouchpoint] = useState<string>(PRIVACY_NOTICE_TOUCHPOINTS[0]);
  const [textEn, setTextEn] = useState('');
  const [textAr, setTextAr] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listPrivacyNotices());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'pnRefusalAct', 'privacy-notice.read')
          : err instanceof ApiError
            ? err.message
            : t('pnLoadError'),
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
        err instanceof ApiError ? err.message : t('pnActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createPrivacyNotice({ touchpoint, textEn: textEn.trim(), textAr: textAr.trim() });
      setTextEn('');
      setTextAr('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('pnHeading')}
        description={t('pnIntro')}
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
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('pnTouchpointLabel')}
            <select
              aria-label={t('pnTouchpointLabel')}
              value={touchpoint}
              onChange={(e) => setTouchpoint(e.target.value)}
            >
              {PRIVACY_NOTICE_TOUCHPOINTS.map((opt) => (
                <option key={opt} value={opt}>
                  {t(ENUM_LABEL.PrivacyNoticeTouchpoint[opt])}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('pnTextEnLabel')}
            <textarea
              aria-label={t('pnTextEnLabel')}
              value={textEn}
              onChange={(e) => setTextEn(e.target.value)}
              required
              rows={3}
              style={{ minWidth: '20rem' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('pnTextArLabel')}
            <textarea
              aria-label={t('pnTextArLabel')}
              dir="rtl"
              value={textAr}
              onChange={(e) => setTextAr(e.target.value)}
              required
              rows={3}
              style={{ minWidth: '20rem' }}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('pnPublishingButton') : t('pnPublishButton')}
          </button>
        </form>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('pnNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('pnTouchpointLabel')}</Th>
                  <Th>{t('pnColVersion')}</Th>
                  <Th>{t('pnColPublished')}</Th>
                  <Th>{t('pnColLegallyReviewed')}</Th>
                  <Th>{t('pnColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <Tr key={n.id}>
                    <Td>{n.touchpoint}</Td>
                    <Td>{n.versionNumber}</Td>
                    <Td>{n.publishedAt.slice(0, 10)}</Td>
                    <Td>{n.legallyReviewedAt ? n.legallyReviewedAt.slice(0, 10) : '—'}</Td>
                    <Td>
                      {canManage && !n.legallyReviewedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => recordPrivacyNoticeLegalReview(n.id))}
                        >
                          {t('pnRecordLegalReviewButton')}
                        </button>
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
        <SkeletonList rows={4} label={t('pnLoading')} />
      )}
    </main>
  );
}
