'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { type Prospect } from '../../../../lib/prospect/prospect-api';
import { ProspectConversionForm } from '../../../../components/prospect/ProspectConversionForm';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

// Roles the seeded permission grid grants `prospect.capture` to
// (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// same convention as leads/page.tsx's CAN_CREATE_LEAD_ROLES. The backend
// independently enforces this on POST /prospects regardless.
const CAN_CAPTURE_PROSPECT_ROLES = ['SALES_RELATIONSHIP_OFFICER'];

function ConvertProspectForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // leadFullName is a display-only prefill hint passed by the pipeline
  // board, which already holds the full Lead in memory — never trusted as
  // the source of truth. The backend re-derives everything it needs from
  // leadId alone (ProspectService.convert looks the Lead up itself).
  const leadId = searchParams.get('leadId') ?? '';
  const leadFullName = searchParams.get('leadFullName') ?? undefined;

  function handleProspectCreated(prospect: Prospect) {
    router.push(`/prospects/${prospect.id}`);
  }

  if (!leadId) {
    return (
      <p role="alert" style={errorStyle}>
        No lead selected — go back to the{' '}
        <button type="button" onClick={() => router.push('/leads')} style={{ textDecoration: 'underline' }}>
          pipeline
        </button>{' '}
        and convert a qualified lead from there.
      </p>
    );
  }

  return (
    <ProspectConversionForm
      leadId={leadId}
      defaultCompanyName={leadFullName}
      onProspectCreated={handleProspectCreated}
    />
  );
}

export default function NewProspectPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const canCaptureProspect = user.roles.some((role) => CAN_CAPTURE_PROSPECT_ROLES.includes(role));

  return (
    <main style={pageStyle}>
      <h1>Qualify prospect</h1>
      <p style={{ opacity: 0.8 }}>
        Process 2 — convert a qualified lead into a prospect and capture its qualification
        profile (sector, activity, size, location, contact, products of interest, expected
        premium).
      </p>
      {canCaptureProspect ? (
        <Suspense fallback={null}>
          <ConvertProspectForm />
        </Suspense>
      ) : (
        <p role="alert" style={errorStyle}>
          You don&apos;t hold the prospect.capture permission, so there&apos;s nothing to do here.
        </p>
      )}
    </main>
  );
}
