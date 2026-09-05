'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listInsurancePrograms,
  type InsuranceProgram,
} from '../../../lib/insurance-program/insurance-program-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import { programListCardStyle } from '../../../components/insurance-program/insurance-program.styles';

function ProgramsForCustomer({ customerId }: { customerId: string }) {
  const router = useRouter();

  const [programs, setPrograms] = useState<InsuranceProgram[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPrograms(await listInsurancePrograms(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the program.read permission, so there's nothing to show here."
          : err instanceof ApiError && err.status === 404
            ? 'This customer could not be found — it may not exist, or you may not have access to it.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load insurance programs — try again.',
      );
    }
  }, [customerId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!programs) return <p>Loading…</p>;

  if (programs.length === 0) {
    return (
      <p style={{ opacity: 0.6, marginTop: '1rem' }}>
        No insurance program yet for this customer — assemble one from an
        approved needs assessment.
      </p>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      {programs.map((program) => (
        <button
          key={program.id}
          type="button"
          style={programListCardStyle}
          aria-label={`Open insurance program ${program.id}`}
          onClick={() => router.push(`/insurance-programs/${program.id}`)}
        >
          <strong>Status: {program.status}</strong>
          <div style={cardMetaStyle}>
            {program.lines.length} line{program.lines.length === 1 ? '' : 's'}
          </div>
          <div style={cardMetaStyle}>
            Assembled {new Date(program.createdAt).toLocaleDateString()}
          </div>
        </button>
      ))}
    </div>
  );
}

function InsuranceProgramsFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        No customer selected — open a customer from{' '}
        <button
          type="button"
          onClick={() => router.push('/customers')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          Customers
        </button>{' '}
        and open its insurance program from there.
      </p>
    );
  }

  return <ProgramsForCustomer customerId={customerId} />;
}

export default function InsuranceProgramsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Insurance programs</h1>
      <p style={{ opacity: 0.8 }}>
        Process 7 — a multi-line Insurance Program assembled from an approved
        needs assessment&apos;s coverage list and the risk survey&apos;s
        derived Sum Insured, then finalized to feed an RFQ.
      </p>
      <Suspense fallback={null}>
        <InsuranceProgramsFlow />
      </Suspense>
    </main>
  );
}
