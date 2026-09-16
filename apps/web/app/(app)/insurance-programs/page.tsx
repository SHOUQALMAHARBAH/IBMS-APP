'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { SentenceWithLink } from '../../../components/ui/SentenceWithLink';
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
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';

function ProgramsForCustomer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { language, t, tPlural } = useLanguage();

  const [programs, setPrograms] = useState<InsuranceProgram[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPrograms(await listInsurancePrograms(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('iprogNoPermission')
          : err instanceof ApiError && err.status === 404
            ? t('iprogCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('iprogLoadError'),
      );
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, t]);

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!programs) return <p>{t('iprogLoading')}</p>;

  if (programs.length === 0) {
    return (
      <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>
        {t('iprogNoneForCustomer')}
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
          aria-label={t('iprogOpenProgramAria', { id: program.id })}
          onClick={() => router.push(`/insurance-programs/${program.id}`)}
        >
          <strong>Status: {program.status}</strong>
          <div style={cardMetaStyle}>
            {tPlural('iprogLineCount', program.lines.length)}
          </div>
          <div style={cardMetaStyle}>
            Assembled {formatDate(program.createdAt, language)}
          </div>
        </button>
      ))}
    </div>
  );
}

function InsuranceProgramsFlow() {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        <SentenceWithLink
          sentence={t('iprogNoCustomerSelected')}
          linkLabel={t('navCustomers')}
          onLinkClick={() => router.push('/customers')}
        />
      </p>
    );
  }

  return <ProgramsForCustomer customerId={customerId} />;
}

export default function InsuranceProgramsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('iprogHeading')}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('iprogIntro')}
      </p>
      <Suspense fallback={null}>
        <InsuranceProgramsFlow />
      </Suspense>
    </main>
  );
}
