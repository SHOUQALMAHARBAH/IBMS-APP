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

// Roles the seeded permission grid grants `access-recertification.cycle.start`
// to (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// so the "Start a cycle" form isn't offered to someone who'll just get a 403.
// The backend remains the sole source of truth.
const CAN_START_CYCLE_ROLES = ['SYSTEM_SECURITY_ADMINISTRATOR', 'COMPLIANCE_OFFICER'];

export default function AccessRecertificationPage() {
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
          ? "You don't hold the access-recertification.review permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load your review queue — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadItems();
    })();
  }, [user, loadItems]);

  if (isLoading || !user) return null;

  const canStartCycle = user.roles.some((role) => CAN_START_CYCLE_ROLES.includes(role));

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
      <h1>Access recertification</h1>
      <p style={{ opacity: 0.8 }}>
        Part 5.1 — periodic (quarterly) review of who holds access. Confirm, revoke, or flag each
        item below; a System/Security Administrator&apos;s own access is included and reviewed the
        same as anyone else&apos;s.
      </p>

      {canStartCycle ? <StartCyclePanel onCycleStarted={() => void loadItems()} /> : null}

      <section style={{ marginTop: '2rem' }}>
        <h2>Your review queue</h2>
        {items === null && !loadError ? <p>Loading…</p> : null}
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
