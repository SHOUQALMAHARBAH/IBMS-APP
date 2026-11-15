'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import {
  createRfq,
  getArticle15DOptions,
  listSelectableInsurers,
  type Article15DChoice,
  type Article15DOptions,
  type SelectableInsurer,
} from '../../../../lib/rfq/rfq-api';
import { Article15DWindow } from '../../../../components/rfq/Article15DWindow';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
} from '../../../../components/auth/auth-form.styles';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../../components/ui';
import {
  cardMetaStyle,
  pageStackStyle,
} from '../../../../components/lead/lead.styles';
import { insurerPickerStyle } from '../../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';

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

  /*
   * ART. 15/d. The question belongs on the EXCEPTION, not the routine -- OWNER DECISION 130
   * ruling 1 and decision 123's own test, which is to count the clicks added to the most
   * frequent transaction. So the options are fetched only once the line is named and the
   * shortlist is picked, and the server answers whether the question applies at all.
   *
   * ⛔ THE SCREEN DOES NOT DECIDE THE THRESHOLD. `required` comes back from the server, which
   * reads the minimum out of `LegalValue` at the request's own date. Hard-coding three here
   * would be `check:legal-numbers`'s whole subject, and it would be wrong the day the row moves.
   */
  /*
   * ⚠️ THE FETCHED OPTIONS ARE STORED WITH THE KEY THEY WERE FETCHED FOR, and the render
   * compares — rather than the effect clearing state when the line is too short.
   *
   * `setA15d(null)` in the effect body is a SYNCHRONOUS setState inside an effect, which eslint
   * refuses with «Calling setState synchronously within an effect can trigger cascading
   * renders». It was right, and the fix is not to silence it: a key comparison makes staleness
   * UNREPRESENTABLE instead of merely cleared. ⟶ Without it, options fetched for a motor line
   * could be rendered for a medical one during the moment between the line changing and the next
   * response arriving — and those two lines offer DIFFERENT exemptions, so the employee would be
   * shown a choice the server is about to refuse.
   */
  const [a15dFetch, setA15dFetch] = useState<{
    key: string;
    options: Article15DOptions;
  } | null>(null);
  const [choice, setChoice] = useState<Article15DChoice>({});
  const line = insuranceLine.trim();
  const a15dKey = `${line}|${selected.size}`;

  useEffect(() => {
    if (line.length < 2) return;
    let cancelled = false;
    void (async () => {
      try {
        const options = await getArticle15DOptions({
          opportunityId,
          insuranceLine: line,
          insurerCount: selected.size,
        });
        if (!cancelled) setA15dFetch({ key: `${line}|${selected.size}`, options });
      } catch {
        /*
         * SILENT, and deliberately so: this is a PRE-CHECK, not the enforcement. The server
         * evaluates art. 15/d again on `POST /rfqs` and refuses there with a message naming
         * what is missing, so a failed options read loses a helpful window and never loses the
         * rule. Surfacing an error here would put a scary message on a form the employee has
         * not submitted yet, for a request that may well reach three insurers anyway.
         *
         * ⟶ And nothing is cleared: the stale entry simply stops matching the key, so the
         *   window closes on its own.
         */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunityId, line, selected.size]);

  /** The options, only while they belong to the line and count on screen RIGHT NOW. */
  const a15d = a15dFetch?.key === a15dKey ? a15dFetch.options : null;

  useEffect(() => {
    void (async () => {
      try {
        setInsurers(await listSelectableInsurers());
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? permissionRefusal(t, 'rfqNewRefusalAct', 'rfq.create')
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
        /* Sent ONLY when the server said the question applies. An `article15D` on a request
         * that reaches the minimum is refused by name -- an exemption from a rule that was
         * already satisfied is nothing to be exempt from. */
        article15D: a15d?.required ? choice : undefined,
      });
      router.push(`/rfqs/${rfq.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : t('rfqNewCreateError'),
      );
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <ErrorState title={loadError} />
    );
  }
  if (!insurers) return <SkeletonList rows={4} label={t('commonLoading')} />;

  const canSubmit =
    insuranceLine.trim().length >= 2 && selected.size > 0 && !submitting;

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: '1rem' }}>
      <label
        htmlFor="insuranceLine"
        style={{ display: 'block', fontWeight: 600 }}
      >
        {t('rfqNewLineLabel')}
      </label>
      <div style={cardMetaStyle}>{t('rfqNewLineHint')}</div>
      <input
        id="insuranceLine"
        dir="auto"
        value={insuranceLine}
        onChange={(e) => setInsuranceLine(e.target.value)}
        placeholder={t('rfqLinePlaceholder')}
        style={{ minWidth: '20rem', marginTop: '0.35rem' }}
      />

      <fieldset style={{ border: 'none', padding: 0, marginTop: '1.5rem' }}>
        <legend style={{ fontWeight: 600 }}>
          {t('rfqNewShortlistLegend')}
        </legend>
        <div style={cardMetaStyle}>{t('rfqNewShortlistHint')}</div>
        <div style={insurerPickerStyle}>
          {insurers.length === 0 ? (
            <span style={{ color: 'var(--ink-secondary)' }}>
              {t('rfqNewNoInsurersOnFile')}
            </span>
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

      {a15d ? (
        <Article15DWindow
          options={a15d}
          choice={choice}
          onChange={setChoice}
          disabled={submitting}
        />
      ) : null}

      <div style={{ marginTop: '1.5rem' }}>
        <button type="submit" disabled={!canSubmit} style={buttonStyle}>
          {submitting ? t('rfqNewCreatingButton') : t('rfqNewCreateButton')}
        </button>
      </div>

      {submitError ? (
        <ErrorState title={submitError} />
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
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  /*
   * ITEM 6 — THE GATE THAT WAS MISSING. Owner decision, 2026-10-17: "install the gate. Every role in
   * the system can open those two pages today, including the DPO and the collections officer. This is
   * a hole in the screen layer, not a decision."
   *
   * AND THE CORRECTION THAT BOUNDS IT, because it was first described to her as a security hole and
   * it is not one: `rfq.controller.ts` requires `rfq.read` on `GET /rfqs` and `rfq.create` on
   * `POST /rfqs`, so the API refuses a caller without them. Only the PAGE was reachable, and whoever
   * opened it saw an empty screen and no data. Same harmless direction as the other findings — a
   * screen that renders nothing rather than a screen that discloses something.
   *
   * What the gate buys is therefore not confidentiality; it is that a role which has no business here
   * is TOLD so instead of being shown a blank page it cannot act on, which is this product's standing
   * rule for a reader who is refused.
   */
  if (!hasPermission(user, 'rfq.create')) {
    return (
      <main style={pageStackStyle}>
        <PageHeader title={t('rfqNewHeading')} />
        <p role="status" data-permission-refusal>
          {permissionRefusal(t, 'rfqNewRefusalAct', 'rfq.create')}
        </p>
      </main>
    );
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('rfqNewHeading')}
        description={t('rfqNewIntro')}
      />
      <Suspense fallback={null}>
        <NewRfqFlow />
      </Suspense>
    </main>
  );
}
