'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listLeads, type Lead, type LeadStatus } from '../../../lib/lead/lead-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { LeadIntakeForm } from '../../../components/lead/LeadIntakeForm';
import { LeadPipelineBoard } from '../../../components/lead/LeadPipelineBoard';
import { pageStyle } from '../../../components/lead/lead.styles';

// Roles the seeded permission grid grants `lead.create` to
// (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// same convention as access-recertification's CAN_START_CYCLE_ROLES. The
// backend independently enforces this on POST /leads regardless.
const CAN_CREATE_LEAD_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

export default function LeadsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

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
          ? "You don't hold the lead.list.read permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the lead pipeline — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadLeads();
    })();
  }, [user, loadLeads]);

  if (isLoading || !user) return null;

  const canCreateLead = user.roles.some((role) => CAN_CREATE_LEAD_ROLES.includes(role));

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
    <main style={pageStyle}>
      <h1>Leads</h1>
      <p style={{ opacity: 0.8 }}>
        Process 1 — capture a lead from any acquisition source and move it through the pipeline
        (New → Contacted → Qualified → Converted to prospect, or Disqualified at any stage).
      </p>

      {canCreateLead ? <LeadIntakeForm onLeadCreated={handleLeadCreated} /> : null}

      <section style={{ marginTop: '2rem' }}>
        <h2>Pipeline</h2>
        {leads === null && !loadError ? <p>Loading…</p> : null}
        {loadError ? (
          <p role="alert" style={errorStyle}>
            {loadError}
          </p>
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
