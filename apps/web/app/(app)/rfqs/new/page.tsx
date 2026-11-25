'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import {
  createRfq,
  getArticle15DOptions,
  listAvailableLines,
  listSelectableInsurers,
  type AvailableLine,
  type Article15DChoice,
  type Article15DOptions,
  type SelectableInsurer,
  OPPORTUNITY_NOT_OPEN_FOR_RFQ,
} from '../../../../lib/rfq/rfq-api';
import {
  OPPORTUNITY_STATUS_LABEL_KEY,
} from '../../../../lib/opportunity/opportunity-status';
import type { OpportunityStatus } from '../../../../lib/opportunity/opportunity-api';
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
import {
  insurerDisplayName,
  lineDisplayName,
} from '../../../../lib/i18n/names';
import {
  loadIndependently,
  namedFailures,
} from '../../../../lib/load-independently';

function NewRfqForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const { language, t } = useLanguage();

  const [insurers, setInsurers] = useState<SelectableInsurer[] | null>(null);
  /*
   * §P3 — the lines this opportunity can still be taken to market on. `null` while loading, so
   * the chooser can say «nothing to choose» only once it KNOWS, rather than during the first
   * render of every visit.
   */
  const [lines, setLines] = useState<AvailableLine[] | null>(null);
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
        /*
         * 🔴 `loadIndependently`, NOT `Promise.all` — and `check:loaders` refused the first
         * version by name, rightly.
         *
         * With `Promise.all`, a 403 on EITHER list discarded the other: a caller who could
         * read insurers but not the available lines (or the reverse) got an empty form and one
         * sentence about neither. Keep what arrived, and NAME what did not.
         *
         * Both labels already ship: the shortlist's own legend and the line field's own label.
         * ⛔ Nothing composed.
         */
        const { values, failures } = await loadIndependently([
          {
            key: 'insurers',
            label: t('rfqNewShortlistLegend'),
            load: listSelectableInsurers,
          },
          {
            key: 'lines',
            label: t('rfqNewLineLabel'),
            load: () => listAvailableLines(opportunityId),
          },
        ]);
        if (values.insurers) setInsurers(values.insurers as SelectableInsurer[]);
        if (values.lines) setLines(values.lines as AvailableLine[]);
        setLoadError(
          failures.length === 0
            ? null
            : `${t('commonListsMissing')} ${namedFailures(failures)}`,
        );
        return;
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
  }, [opportunityId, t]);

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
      setSubmitError(refusalText(err));
      setSubmitting(false);
    }
  }

  /**
   * OWNER DECISION 157 ruling 1 — her sentence, with the opportunity's stage NAMED.
   *
   * Decision 153 §٢ row ١٦ ratified «…لأنها في مرحلة التنسيب», and the server refuses in every
   * status but `NEEDS_CONFIRMED` and `RFQ_ISSUED` — so six of the eight stages the sentence can
   * be shown for made it untrue. 157 keeps the sentence and lets the stage name itself.
   *
   * ⛔ Read off the refusal's stable CODE and its `opportunityStatus` field, never its prose.
   * This screen holds only `?opportunityId=` and never fetches the record, so the refusal is the
   * only thing that can tell it the stage. An unknown stage falls back to the server's own
   * message rather than printing a raw enum token at a reader.
   */
  function refusalText(err: unknown): string {
    if (!(err instanceof ApiError)) return t('rfqNewCreateError');
    if (err.code === OPPORTUNITY_NOT_OPEN_FOR_RFQ) {
      const status = err.details?.opportunityStatus;
      const key =
        typeof status === 'string'
          ? OPPORTUNITY_STATUS_LABEL_KEY[status as OpportunityStatus]
          : undefined;
      if (key) {
        return t('rfqOpportunityStatusRefusal', { status: t(key) });
      }
    }
    return err.message;
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
      {/*
        §P3 — A CHOICE, NOT FREE TEXT.

        The server matches this byte-for-byte against the programme's own line strings, so there
        is exactly one correct value per line and the system knows all of them. The old free-text
        box could not be typed correctly by a reader of this screen: its hint gave two ARABIC
        examples and the server only accepts the English programme vocabulary.

        ⛔ `rfqNewLineHint` and `rfqLinePlaceholder` are GONE rather than reworded. Both described
        how to type a value into a box that no longer exists, and decision 125 forbids composing a
        replacement sentence out of words that ship elsewhere. If this chooser needs a sentence,
        it is the owner's to write.
      */}
      <select
        id="insuranceLine"
        value={insuranceLine}
        onChange={(e) => setInsuranceLine(e.target.value)}
        disabled={lines !== null && lines.length === 0}
        style={{ minWidth: '20rem', marginTop: '0.35rem' }}
      >
        {/*
          ⚠️ `crateLineChoose` IS BORROWED FROM THE COMMISSION DICTIONARY, DELIBERATELY.

          It already ships as «اختر فرع تأمين…» — "select an insurance line…" — on
          `/commission`'s own line chooser, which is the identical control asking the identical
          question. The standing rule permits a string already shipping FOR THE SAME THING, and
          ⛔ forbids composing a new one; minting a second key would put one sentence in two
          homes, which is how they drift apart.

          ⟶ It also already says «فرع تأمين», which is the vocabulary decision 150 ruling 5
            settles — so this control is born saying the right word rather than needing §6 to
            come back for it.
        */}
        <option value="">{t('crateLineChoose')}</option>
        {(lines ?? []).map((l) => (
          <option key={l.insuranceLine} value={l.insuranceLine}>
            {lineDisplayName(l, language)}
          </option>
        ))}
      </select>

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
                {/*
                  🔴 THE RATING LEAVES THIS LABEL, AND THE ENGLISH «(sample rating)» GOES WITH IT.

                  The owner's walk saw «(sample rating)» beside three companies here. It is a
                  STORED value — `SAMPLE_INSURERS` in `packages/db/prisma/seed-data/insurers.ts`
                  writes «A- (sample rating)» — and ⛔ that seed is what a REAL install runs, so
                  it is not edited to tidy a demo screen.

                  ⟶ WHAT SETTLED IT IS NOT THE ENGLISH WORD BUT THE DATE. A rating with no date
                    is «دعوى لا سجلّ عناية» — the dictionary's correction 5, which the database
                    enforces as `Insurer_rating_carries_its_date` (neither half may stand alone)
                    and which `/insurers/[id]` renders accordingly, rating AND as-of together.
                    `SelectableInsurer` carries `financialStrengthRating` and NOT
                    `financialStrengthRatingAsOf`, so this label was showing the one half the
                    constraint refuses to let stand alone, on a picker.

                  ⛔ AND THE PAYLOAD IS NOT WIDENED TO ADD THE DATE: that would put a free-text
                  rating plus a date inside a checkbox label, which is longer and still renders
                  an office's own free text as part of a control's name.

                  ⚠️ The rating is unchanged on `/insurers/[id]`, with its date, which is where a
                  due-diligence record belongs. REPORTED: the owner's other option was to keep
                  the grade and drop the English word, which is a one-line change here.
                */}
                <span>
                  <bdi>{insurerDisplayName(insurer, language)}</bdi>
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>

      {/*
        🔴 DIRECTLY UNDER THE INSURER LIST, which is what makes it visible at all.

        The owner’s walk (§S3): «خالد يختار الشركة الثانية في طلب العرض. يظهر سؤال الإعفاء
        تحت، خارج ما يراه، فيظنّ أن شيئاً لم يحصل.» This section is what art. 15/d asks when a
        shortlist falls short of the minimum, and it was rendered AFTER the follow-up threshold
        field — so on an ordinary window it appeared below the fold, triggered by a click the
        employee had just made somewhere else entirely. Nothing scrolled to it and nothing
        pointed at it.

        ⟶ MOVED rather than scrolled to, deliberately. A scroll-on-appearance moves the page
          under a mouse that has not been told to expect it, and for a KEYBOARD user it is worse:
          focus stays on the insurer checkbox while the viewport jumps somewhere else, which is
          the one thing a screen must not do to someone who cannot see where it went. Moving the
          markup costs nothing at runtime and puts the question beside its own cause.

        ⟶ For a keyboard user the tab order now runs: the last insurer checkbox, then the
          exemption controls, then the threshold field, then submit. The question is reached by
          pressing Tab once from the control that raised it — no scroll, no focus move, and
          nothing is announced that the reader did not navigate to.

        ⛔ NOT ONE WORD CHANGES. `Article15DWindow` is untouched.
      */}
      {a15d ? (
        <Article15DWindow
          options={a15d}
          choice={choice}
          onChange={setChoice}
          disabled={submitting}
        />
      ) : null}

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
