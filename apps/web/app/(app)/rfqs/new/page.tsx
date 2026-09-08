'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  createRfq,
  listSelectableInsurers,
  type SelectableInsurer,
} from '../../../../lib/rfq/rfq-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../../components/lead/lead.styles';
import { insurerPickerStyle } from '../../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

function NewRfqForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const { t } = useLanguage();

  const [insurers, setInsurers] = useState<SelectableInsurer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [insuranceLine, setInsuranceLine] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState('9');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setInsurers(await listSelectableInsurers());
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? t('rfqNewNoPermission')
            : err instanceof ApiError
              ? err.message
              : t('rfqNewInsurerListLoadError'),
        );
      }
    })();
  }, [t]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const parsedThreshold = Number.parseInt(threshold, 10);
      const rfq = await createRfq({
        opportunityId,
        insuranceLine: insuranceLine.trim(),
        insurerIds: [...selected],
        followUpThresholdDays: Number.isFinite(parsedThreshold)
          ? parsedThreshold
          : undefined,
      });
      router.push(`/rfqs/${rfq.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : t('rfqNewCreateError'),
      );
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!insurers) return <p>{t('commonLoading')}</p>;

  const canSubmit =
    insuranceLine.trim().length >= 2 && selected.size > 0 && !submitting;

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: '1rem' }}>
      <label htmlFor="insuranceLine" style={{ display: 'block', fontWeight: 600 }}>
        {t('rfqNewLineLabel')}
      </label>
      <div style={cardMetaStyle}>{t('rfqNewLineHint')}</div>
      <input
        id="insuranceLine"
        dir="auto"
        value={insuranceLine}
        onChange={(e) => setInsuranceLine(e.target.value)}
        placeholder="Property All Risks"
        style={{ minWidth: '20rem', marginTop: '0.35rem' }}
      />

      <fieldset style={{ border: 'none', padding: 0, marginTop: '1.5rem' }}>
        <legend style={{ fontWeight: 600 }}>{t('rfqNewShortlistLegend')}</legend>
        <div style={cardMetaStyle}>{t('rfqNewShortlistHint')}</div>
        <div style={insurerPickerStyle}>
          {insurers.length === 0 ? (
            <span style={{ opacity: 0.6 }}>{t('rfqNewNoInsurersOnFile')}</span>
          ) : (
            insurers.map((insurer) => (
              <label
                key={insurer.id}
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(insurer.id)}
                  onChange={() => toggle(insurer.id)}
                />
                <span>
                  <bdi>{insurer.name}</bdi>
                  {insurer.financialStrengthRating
                    ? ` · ${insurer.financialStrengthRating}`
                    : ''}
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>

      <label
        htmlFor="threshold"
        style={{ display: 'block', fontWeight: 600, marginTop: '1.5rem' }}
      >
        {t('rfqNewThresholdLabel')}
      </label>
      <div style={cardMetaStyle}>{t('rfqNewThresholdHint')}</div>
      <input
        id="threshold"
        type="number"
        min={1}
        max={90}
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        style={{ width: '6rem', marginTop: '0.35rem' }}
      />

      <div style={{ marginTop: '1.5rem' }}>
        <button type="submit" disabled={!canSubmit} style={buttonStyle}>
          {submitting ? t('rfqNewCreatingButton') : t('rfqNewCreateButton')}
        </button>
      </div>

      {submitError ? (
        <p role="alert" style={errorStyle}>
          {submitError}
        </p>
      ) : null}
    </form>
  );
}

function NewRfqFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const opportunityId = searchParams.get('opportunityId') ?? '';

  if (!opportunityId) {
    return (
      <p role="alert" style={errorStyle}>
        {t('rfqNewNoOpportunitySelectedPrefix')}{' '}
        <button
          type="button"
          onClick={() => router.push('/opportunities')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          {t('rfqListNoParentLinkLabel')}
        </button>{' '}
        {t('rfqNewNoOpportunitySelectedSuffix')}
      </p>
    );
  }

  return <NewRfqForm opportunityId={opportunityId} />;
}

export default function NewRfqPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('rfqNewHeading')}</h1>
      <p style={{ opacity: 0.8 }}>{t('rfqNewIntro')}</p>
      <Suspense fallback={null}>
        <NewRfqFlow />
      </Suspense>
    </main>
  );
}
