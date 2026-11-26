'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listLeads, type Lead, type LeadStatus } from '../../../lib/lead/lead-api';
import { ApiError } from '../../../lib/auth/api-client';
import { LeadIntakeForm } from '../../../components/lead/LeadIntakeForm';
import { LeadPipelineBoard } from '../../../components/lead/LeadPipelineBoard';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { hasPermission } from '../../../lib/auth/permissions';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/*
 * ⛔ OWNER DECISION 166 — THIS SCREEN'S REDESIGN IS RULED AND IS NOT BUILT YET, AND THAT IS A
 * SCHEDULE RATHER THAN AN OMISSION.
 *
 * `docs/decision-166-leads-pipeline-design.md` ratifies a numbered stage BAR over ONE paginated,
 * searchable, filterable table ordered by longest-in-stage — replacing `LeadPipelineBoard`'s five
 * columns — with a days-in-stage column, a «واقف» mark on an office-set day threshold, one
 * next-step button per row, an «exclude» secondary action taking a reason from a CLOSED list, a
 * transitions log in a side panel, and the intake form in a side panel behind a header button
 * rather than above the pipeline. It is built as ONE «pipeline» component every staged screen
 * reuses.
 *
 * ⛔ IT IS NOT BUILT HERE, BY HER OWN TWO CONDITIONS: «يُبنى بعد إقفال مديول ١», and the nine
 * marked words — the five exclusion reasons and the «واقف» default among them — go to her on an
 * answer sheet FIRST. ⚠️ So this is not the «decided and not built» column of the decision index
 * either: that column records a decision NOT to build, and this one is dated work waiting on
 * words. Whoever builds it before both conditions are met invents Arabic she has not given.
 *
 * It also needs the server: a stage-change date or a transitions table, the exclusion reason as a
 * fixed list, and pagination, search, filtering and per-stage counts on `GET /leads`.
 */

// Roles the seeded permission grid grants `lead.create` to
// (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// same convention as access-recertification's CAN_START_CYCLE_ROLES. The
// backend independently enforces this on POST /leads regardless.

export default function LeadsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      const result = await listLeads();
      setLeads(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'leadsRefusalAct', 'lead.list.read')
          : err instanceof ApiError
            ? err.message
            : t('commonTryAgain'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadLeads();
    })();
  }, [user, loadLeads, t]);

  if (isLoading || !user) return null;

  const canCreateLead = hasPermission(user, 'lead.create');

  function handleLeadCreated(lead: Lead) {
    setLeads((prev) => (prev ? [lead, ...prev] : [lead]));
  }

  function handleLeadTransitioned(result: { id: string; status: LeadStatus }) {
    // Only patch the field the transition endpoint actually returns — it's
    // WorkflowTransitionService's generic { id, status } shape, not the full
    // Lead, so replacing the whole row here would wipe fullName/source/etc.
    // and crash the board (same lesson as access-recertification's decide()).
    setLeads((prev) =>
      prev ? prev.map((l) => (l.id === result.id ? { ...l, status: result.status } : l)) : prev,
    );
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('leadsHeading')}
        description={t('leadsProcessIntro')}
      />

      {canCreateLead ? <LeadIntakeForm onLeadCreated={handleLeadCreated} /> : null}

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('leadsPipelineHeading')}</h2>
        {leads === null && !loadError ? <SkeletonList rows={4} label={t('commonLoading')} /> : null}
        {loadError ? (
          <ErrorState title={loadError} />
        ) : null}
        {leads !== null && !loadError ? (
          <LeadPipelineBoard
            leads={leads}
            currentUserId={user.id}
            onLeadTransitioned={handleLeadTransitioned}
          />
        ) : null}
      </section>
    </main>
  );
}
