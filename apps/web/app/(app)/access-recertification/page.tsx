'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listMyRecertificationItems,
  type RecertificationDecisionResult,
  type RecertificationItem,
} from '../../../lib/access-recertification/access-recertification-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { StartCyclePanel } from '../../../components/access-recertification/StartCyclePanel';
import { RecertificationItemsTable } from '../../../components/access-recertification/RecertificationItemsTable';
import { pageStyle } from '../../../components/access-recertification/access-recertification.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

// Roles the seeded permission grid grants `access-recertification.cycle.start`
// to (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// so the t('acrStartCycleButton') form isn't offered to someone who'll just get a 403.
// The backend remains the sole source of truth.

export default function AccessRecertificationPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [items, setItems] = useState<RecertificationItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const result = await listMyRecertificationItems();
      setItems(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('acrNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('acrLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadItems();
    })();
  }, [user, loadItems, t]);

  if (isLoading || !user) return null;

  const canStartCycle = hasPermission(user, 'access-recertification.cycle.start');

  function handleItemDecided(result: RecertificationDecisionResult) {
    // Only patch the fields the decision endpoint actually returns — it's
    // the raw AccessRecertificationItem, not the enriched GET .../items
    // shape, so replacing the whole row here would wipe subjectFullName/
    // subjectRoles/etc. and crash the next render.
    setItems((prev) =>
      prev
        ? prev.map((i) =>
            i.id === result.id ? { ...i, decision: result.decision, reviewedAt: result.reviewedAt } : i,
          )
        : prev,
    );
  }

  return (
    <main style={pageStyle}>
      <h1>{t('acrHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('acrIntro')}
      </p>

      {canStartCycle ? <StartCyclePanel onCycleStarted={() => void loadItems()} /> : null}

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('acrQueueHeading')}</h2>
        {items === null && !loadError ? <p>{t('acrLoading')}</p> : null}
        {loadError ? (
          <p role="alert" style={errorStyle}>
            {loadError}
          </p>
        ) : null}
        {items !== null && !loadError ? (
          <RecertificationItemsTable items={items} onItemDecided={handleItemDecided} />
        ) : null}
      </section>
    </main>
  );
}
