'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { CombinedDutyOnRecord } from '../../../components/ui/CombinedDutyOnRecord';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { WorkflowHistoryLink } from '../../../components/ui/WorkflowHistoryLink';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../../../components/ui/CombinedDutyReasonField';
import {
  DISPOSAL_METHODS,
  closeDisposalBatch,
  confirmRetentionScheduleItem,
  createLegalHold,
  createRetentionScheduleItem,
  dpoApproveDisposalBatch,
  executeDisposalBatch,
  issueCertificateOfDestruction,
  listDisposalBatches,
  listLegalHolds,
  listRetentionSchedule,
  managerApproveDisposalBatch,
  nominateDisposalBatch,
  releaseLegalHold,
  reviewLegalHold,
  updateRetentionScheduleItem,
  type DisposalBatch,
  type LegalHold,
  type RetentionScheduleItem,
} from '../../../lib/pdpl/retention-disposal-api';
import { ApiError } from '../../../lib/auth/api-client';
// TEN, imported rather than written again. The api holds this figure in exactly one place
// (`common/declaration-reason.ts`) and the owner's instruction was that two minimums for one
// concept is the drift we keep paying for — which applies across the boundary too.
import {
  NO_FLOOR_REASON_MIN_LENGTH,
  extendRetention,
  listRetentionNotices,
  listArchiveRetrievals,
  retrieveBlockedRecords,
  type ArchiveRetrieval,
  type ArchiveRetrievalBasis,
  type ExtendRetentionInput,
  type RetentionNotice,
} from '../../../lib/pdpl/retention-disposal-api';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import {
  loadIndependently,
  namedFailures,
} from '../../../lib/load-independently';
import { permissionRefusalAllOf } from '../../../lib/i18n/permission-refusal';

const SCHEDULE_ROLES = [
  // MODULE 0 CLOSE, DECISION 3 — the umbrella split. The screen needs EITHER half to be useful:
  // the maker to set a period, the checker to confirm one. Listing both is what keeps a
  // confirm-only holder from meeting a refusal on a screen they legitimately work on.
  'retention-schedule.update',
  'retention-schedule.confirm',
];
const LEGAL_HOLD_ROLES = [
  'legal-hold.manage',
];
const DISPOSE_NOMINATE_ROLES = [
  'retention.dispose.nominate',
];
/*
 * THE NOTICE GOES TO HOLDERS OF ANY OF THE ACTS, never to a role name — the owner's standing rule,
 * carried from the licence notice unchanged. A Branch/Department Manager who may nominate a disposal
 * sees the same list as the Compliance Officer who may extend, and TWO DIFFERENT PEOPLE ACTING ON
 * ONE LIST IS THE SEGREGATION WORKING rather than a defect to smooth over.
 */
const NOTICE_ROLES = [
  'retention.extend',
  'retention.dispose.nominate',
  'retention.dispose.approve',
];
const EXTEND_ROLES = ['retention.extend'];

/*
 * BATCH 5 GROUP 7c — retrieval from the blocked phase, and this one is NOT an any-of.
 *
 * The notice above goes to holders of ANY act because they must all see the same list. Retrieving a
 * blocked record is a capability a holder of `retention.dispose.nominate` does not have, so this
 * names one code: an any-of here would make the narrower code decorative.
 */
const ARCHIVE_RETRIEVE_ROLES = ['retention.archive.retrieve'];

const DISPOSE_APPROVE_ROLES = [
  'retention.dispose.approve',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const sectionStyle: CSSProperties = { margin: '2rem 0' };


export default function RetentionDisposalPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManageSchedule = hasAnyPermission(user, SCHEDULE_ROLES);
  const canManageHolds = hasAnyPermission(user, LEGAL_HOLD_ROLES);
  const canNominate = hasAnyPermission(user, DISPOSE_NOMINATE_ROLES);
  const canApprove = hasAnyPermission(user, DISPOSE_APPROVE_ROLES);
  // ANY of the acts — the notice is not routed to one of them.
  const canSeeNotices = hasAnyPermission(user, NOTICE_ROLES);
  const canExtend = hasAnyPermission(user, EXTEND_ROLES);
  const canRetrieve = hasAnyPermission(user, ARCHIVE_RETRIEVE_ROLES);

  const [retrievals, setRetrievals] = useState<ArchiveRetrieval[] | null>(null);
  const [retrieveCategory, setRetrieveCategory] = useState('');
  const [retrieveIds, setRetrieveIds] = useState('');
  const [retrieveBasis, setRetrieveBasis] =
    useState<ArchiveRetrievalBasis>('JUDICIAL_REQUEST');
  const [retrieveNote, setRetrieveNote] = useState('');
  const [retrieveDone, setRetrieveDone] = useState(false);
  const [schedule, setSchedule] = useState<RetentionScheduleItem[] | null>(null);
  const [holds, setHolds] = useState<LegalHold[] | null>(null);
  const [batches, setBatches] = useState<DisposalBatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Part 4 — the combined-duty reason, keyed by record so two rows cannot share one box.
  const [declarations, setDeclarations] = useState<Record<string, string>>({});

  const [category, setCategory] = useState('');
  const [months, setMonths] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const [editMonths, setEditMonths] = useState<Record<string, string>>({});

  /*
   * BATCH 5 GROUP 6 — the no-floor declaration. `null` means the server has not asked; a value is
   * the save it asked about, held so the re-submit sends the same period the notice was shown for.
   *
   * Keyed by the row id, or `'new'` for the create form, so the table's inline editor and the create
   * form cannot share one box — the same reason the combined-duty reasons above are keyed by record.
   */
  const [noFloorAsk, setNoFloorAsk] = useState<{
    key: string;
    recordCategory: string;
    months: number;
  } | null>(null);
  const [noFloorReason, setNoFloorReason] = useState('');
  // NOT pre-ticked and no default: the acknowledgement is an act, not a field.
  const [noFloorAcknowledged, setNoFloorAcknowledged] = useState(false);

  const [holdScope, setHoldScope] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdCategoryId, setHoldCategoryId] = useState('');
  const [holdCustomerId, setHoldCustomerId] = useState('');
  const [holdInsuredPersonId, setHoldInsuredPersonId] = useState('');

  const [notices, setNotices] = useState<RetentionNotice[] | null>(null);
  // The extend form, keyed by category so two rows cannot share one box.
  const [extendFor, setExtendFor] = useState<string | null>(null);
  const [extendMonths, setExtendMonths] = useState('');
  const [extendBasis, setExtendBasis] =
    useState<ExtendRetentionInput['basis']>('LEGISLATIVE_PROVISION');
  const [extendNote, setExtendNote] = useState('');
  const [extendInstrument, setExtendInstrument] = useState('');
  const [extendArticle, setExtendArticle] = useState('');
  const [extendHoldId, setExtendHoldId] = useState('');

  const [nominateCategoryId, setNominateCategoryId] = useState('');
  const [method, setMethod] = useState<string>(DISPOSAL_METHODS[0]);

  /*
   * ITEM 8 — THIS IS ONE OF THE TWO SCREENS CLAUDE.md NAMED, and the fix it named was "copy
   * `/settings/org-units`", which computes what the reader holds and renders that half.
   *
   * Three independent panels, three permissions, and one `Promise.all` that nulled all three on
   * any refusal — so somebody holding `legal-hold.manage` and nothing else saw a screen with no
   * holds on it and a sentence listing three codes. Each panel now stands alone; the all-of
   * refusal is kept for the reader who holds NONE of them, which is the case it was written for.
   */
  const load = useCallback(async () => {
    const { values, failures } = await loadIndependently([
      {
        key: 'schedule',
        label: t('rdListSchedule'),
        load: listRetentionSchedule,
      },
      { key: 'holds', label: t('rdListHolds'), load: listLegalHolds },
      { key: 'batches', label: t('rdListBatches'), load: listDisposalBatches },
      // A FOURTH INDEPENDENT PANEL, never added to a `Promise.all`: a reader refused the notice
      // must still see the schedule, which is the defect this screen was named for.
      { key: 'notices', label: t('rdNoticeHeading'), load: listRetentionNotices },
      /*
       * CONDITIONAL, unlike the four above — and deliberately so. This route is gated on a code most
       * readers of this screen do not hold, so an unconditional entry would 403 for them and the
       * partial-load branch would tell them a list "did not load" every single time. That is both
       * noise and a wrong claim: the list did not fail, they are not permitted it. The frontend
       * directive's own rule — a control a role cannot use does not exist on their screen.
       */
      ...(canRetrieve
        ? [
            {
              key: 'retrievals',
              label: t('rdRetrieveRegisterHeading'),
              load: listArchiveRetrievals,
            },
          ]
        : []),
    ]);
    setSchedule((values.schedule as RetentionScheduleItem[] | undefined) ?? null);
    setHolds((values.holds as LegalHold[] | undefined) ?? null);
    setBatches((values.batches as DisposalBatch[] | undefined) ?? null);
    setNotices((values.notices as RetentionNotice[] | undefined) ?? null);
    setRetrievals((values.retrievals as ArchiveRetrieval[] | undefined) ?? null);
    const allRefused =
      // THE THRESHOLD MOVES WITH THE PANEL COUNT, which is what this comment demanded when it read
      // "4, not 3". It is now computed rather than written, because 7c made the panel count depend
      // on a permission: a reader who may retrieve loads five lists, everybody else loads four, and
      // a literal would make the all-of sentence unreachable for exactly one of those two readers.
      failures.length === (canRetrieve ? 5 : 4) &&
      failures.every((f) => f.error instanceof ApiError && f.error.status === 403);
    setLoadError(
      failures.length === 0
        ? null
        : allRefused
          ? permissionRefusalAllOf(t, 'rdRefusalAct', [
              'retention-schedule.update / retention-schedule.confirm',
              'legal-hold.manage',
              'retention.dispose.nominate / retention.dispose.approve',
            ])
          : `${t('commonListsMissing')} ${namedFailures(failures)}`,
    );
  }, [t, canRetrieve]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('rdActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  /** The sentence this screen renders, and the exact text it sends back to be recorded. */
  const noFloorNotice = t('rdNoFloorNotice');

  function noFloorDeclarationPayload() {
    return {
      noticeShown: noFloorNotice,
      reason: noFloorReason.trim(),
      acknowledged: true as const,
    };
  }

  function clearNoFloorAsk() {
    setNoFloorAsk(null);
    setNoFloorReason('');
    setNoFloorAcknowledged(false);
  }

  /**
   * Runs an action and, if the server asks for a declaration, opens the notice instead of reporting
   * an error. A 422 here is not a failure the reader should see as one — the period is accepted and
   * the office is being asked to record why.
   */
  async function runOrAsk(
    ask: { key: string; recordCategory: string; months: number },
    fn: () => Promise<unknown>,
  ) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      clearNoFloorAsk();
      await load();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'NO_FLOOR_DECLARATION_REQUIRED'
      ) {
        setNoFloorAsk(ask);
        setNoFloorAcknowledged(false);
      } else {
        setActionError(
          err instanceof ApiError ? err.message : t('rdActionError'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitExtend() {
    const category = extendFor;
    if (!category) return;
    await run(async () => {
      await extendRetention({
        recordCategory: category,
        /*
         * THE REAL IDS, from the notice itself. My first version sent `['*']` as a placeholder,
         * which would have written a register row naming NO record — a false entry in the one place
         * that exists to be justifiable. The notice returns the ids precisely so this cannot
         * happen, and a per-file selector narrows this set rather than inventing one.
         */
        recordIds:
          notices?.find((n) => n.recordCategory === category)
            ?.elapsedRecordIds ?? [],
        months: Number(extendMonths),
        basis: extendBasis,
        note: extendNote.trim(),
        instrument: extendInstrument.trim() || undefined,
        article: extendArticle.trim() || undefined,
        legalHoldId: extendHoldId.trim() || undefined,
      });
      setExtendFor(null);
      setExtendMonths('');
      setExtendNote('');
      setExtendInstrument('');
      setExtendArticle('');
      setExtendHoldId('');
    });
  }

  async function submitSchedule(ev: React.FormEvent) {
    ev.preventDefault();
    const recordCategory = category.trim();
    const requested = Number(months);
    const declaring = noFloorAsk?.key === 'new';
    await runOrAsk(
      { key: 'new', recordCategory, months: requested },
      async () => {
        await createRetentionScheduleItem({
          recordCategory,
          retentionPeriodMonths: requested,
          legalBasis: legalBasis.trim() || undefined,
          ...(declaring
            ? { noFloorDeclaration: noFloorDeclarationPayload() }
            : {}),
        });
        setCategory('');
        setMonths('');
        setLegalBasis('');
      },
    );
  }

  async function submitHold(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createLegalHold({
        scope: holdScope.trim(),
        reason: holdReason.trim(),
        retentionScheduleItemId: holdCategoryId.trim() || undefined,
        customerId: holdCustomerId.trim() || undefined,
        insuredPersonId: holdInsuredPersonId.trim() || undefined,
      });
      setHoldScope('');
      setHoldReason('');
      setHoldCategoryId('');
      setHoldCustomerId('');
      setHoldInsuredPersonId('');
    });
  }

  async function submitNominate(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await nominateDisposalBatch(nominateCategoryId.trim() || undefined);
      setNominateCategoryId('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('rdHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('rdIntro')}
      </p>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {/* --- Retention schedule --- */}

      {/*
        THE RETENTION NOTICE — batch 5 group 7b. Placed FIRST because it is the thing that tells the
        office there is something to decide, and B.7 rule 1 is that what a person came for is not
        rendered last.

        IT EXPLAINS ITSELF. The owner's policy paper: "an employee who clicks accept on an alert that
        does not explain itself is an employee signing for the unknown." So every row carries which
        article set the floor, what date the count ran from, and that no hold stands.
      */}
      {canSeeNotices ? (
        <section style={sectionStyle}>
          <h2>{t('rdNoticeHeading')}</h2>
          {/*
            THE BACKUP LIMITATION, on the screen that offers destruction. The owner's policy paper
            records that deleting from the primary database is not destruction while a backup holds
            the row, and this system has no backup-scoped destruction. A product that says
            "destroyed" while a backup holds the row makes a false statement to a regulator.
            `role="status"`, never `alert`: it is a standing limit, not a refusal.
          */}
          <p role="status" data-testid="retention-backup-limit" style={{ color: 'var(--ink-secondary)' }}>
            {t('rdBackupLimit')}
          </p>
          {/*
            THE BLOCKED PHASE, EXPLAINED WHERE THE NOTICE IS READ — batch 5 group 7c.
            It sits here rather than in the retrieval section below, because every holder of an act
            needs to know what an elapsed record's state IS; only a holder of
            `retention.archive.retrieve` needs the control. `role="status"`, never `alert`: this is
            what the system does, not a refusal.

            AND THE SCOPING LIMIT IS ITS OWN PARAGRAPH, which is the brief's own instruction — "for
            the rest, say so rather than implying a protection that is not running". The customer
            file cannot enter this phase, because art. 17/a counts from the END of the relationship
            and this system records no such date.
          */}
          {/*
            TWO CHOICES, NOT THREE — the owner's accepted consequence of anonymisation being held
            (register entry 89). Said here rather than left to be inferred from a missing button: a
            product that lists an act it cannot perform is the claim family this module spent a week
            removing, and the quieter version of that failure is a reader who assumes the third
            choice exists somewhere else on the screen. `role="status"`, not `alert`: it is what the
            system offers, not a refusal.
          */}
          <p
            role="status"
            data-testid="retention-two-choices"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {t('rdNoticeTwoChoices')}
          </p>
          <p data-testid="retention-blocked-what" style={{ color: 'var(--ink-secondary)' }}>
            <strong>{t('rdBlockedHeading')}</strong> — {t('rdBlockedWhat')}
          </p>
          <p
            role="status"
            data-testid="retention-blocked-scope-limit"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {t('rdBlockedScopeLimit')}
          </p>
          {notices === null ? (
            <p>{t('rdNoticeLoading')}</p>
          ) : notices.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoticeNone')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdNoticeColCategory')}</th>
                    <th style={head}>{t('rdNoticeColElapsed')}</th>
                    <th style={head}>{t('rdNoticeColBasis')}</th>
                    <th style={head}>{t('rdNoticeColCountedFrom')}</th>
                    <th style={head}>{t('rdNoticeColChoices')}</th>
                  </tr>
                </thead>
                <tbody>
                  {notices.map((n) => (
                    <tr key={n.recordCategory} data-notice-for={n.recordCategory}>
                      <td style={cell}>{n.recordCategory}</td>
                      <td style={cell}>
                        {/*
                          AN UNRESOLVABLE CATEGORY SAYS SO, LOUDLY, ON ITS OWN ROW — decision 28's
                          family. An office that set a period for a category it named itself and is
                          never alerted will believe the system is watching it, and silence there is
                          the defect.
                        */}
                        {n.resolvable ? (
                          n.elapsedCount
                        ) : (
                          <span data-testid={`retention-unwatched-${n.recordCategory}`}>
                            {t('rdNoticeUnwatched')}
                          </span>
                        )}
                      </td>
                      <td style={cell}>
                        {n.floor
                          ? `${n.floor.instrument}, ${n.floor.article} — ${n.floor.operativeText}`
                          : '—'}
                      </td>
                      <td style={cell}>{n.countedFrom ?? '—'}</td>
                      <td style={cell}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span style={{ color: 'var(--ink-secondary)' }}>
                            {n.noLegalHoldStatement}
                          </span>
                          {canExtend && n.resolvable && n.elapsedCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => setExtendFor(n.recordCategory)}
                            >
                              {t('rdNoticeExtend')}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {extendFor ? (
            <div
              role="status"
              data-testid="retention-extend-form"
              style={{
                margin: '0.75rem 0',
                padding: '0.75rem',
                border: '1px solid var(--border-default)',
                borderRadius: '0.25rem',
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem' }}>
                {t('rdNoticeExtendHeading')} — {extendFor}
              </h3>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {t('rdNoticeMonthsLabel')}
                <input
                  aria-label={t('rdNoticeMonthsLabel')}
                  type="number"
                  min={1}
                  value={extendMonths}
                  onChange={(e) => setExtendMonths(e.target.value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {t('rdNoticeBasisLabel')}
                <select
                  aria-label={t('rdNoticeBasisLabel')}
                  value={extendBasis}
                  onChange={(e) =>
                    setExtendBasis(e.target.value as ExtendRetentionInput['basis'])
                  }
                >
                  <option value="LEGISLATIVE_PROVISION">
                    {t('rdNoticeBasisLegislative')}
                  </option>
                  <option value="LEGAL_HOLD_OR_DISPUTE">{t('rdNoticeBasisHold')}</option>
                  {/*
                    CONSENT IS PRESENT AND DISABLED, with its reason beside it. An option that
                    cannot be substantiated must not be OFFERABLE — and removing it silently would
                    leave a reader wondering whether consent is a basis at all, which is a different
                    and worse confusion than being told why it is unavailable.
                  */}
                  <option value="CUSTOMER_EXPLICIT_CONSENT" disabled>
                    {t('rdNoticeBasisConsent')}
                  </option>
                </select>
              </label>
              <p data-testid="retention-consent-unavailable" style={{ color: 'var(--ink-secondary)' }}>
                {t('rdNoticeConsentWhy')}
              </p>
              {extendBasis === 'LEGISLATIVE_PROVISION' ? (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {t('rdNoticeInstrumentLabel')}
                    <input
                      aria-label={t('rdNoticeInstrumentLabel')}
                      value={extendInstrument}
                      onChange={(e) => setExtendInstrument(e.target.value)}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {t('rdNoticeArticleLabel')}
                    <input
                      aria-label={t('rdNoticeArticleLabel')}
                      value={extendArticle}
                      onChange={(e) => setExtendArticle(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {t('rdNoticeHoldLabel')}
                  <input
                    aria-label={t('rdNoticeHoldLabel')}
                    value={extendHoldId}
                    onChange={(e) => setExtendHoldId(e.target.value)}
                  />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {t('rdNoticeNoteLabel')}
                <textarea
                  aria-label={t('rdNoticeNoteLabel')}
                  rows={3}
                  value={extendNote}
                  onChange={(e) => setExtendNote(e.target.value)}
                />
              </label>
              <button
                type="button"
                /*
                  Disabled until the note reaches the shared declaration minimum, so this screen
                  never sends a request it already knows the server will refuse.
                */
                disabled={
                  busy || extendNote.trim().length < NO_FLOOR_REASON_MIN_LENGTH || !extendMonths
                }
                onClick={() => void submitExtend()}
              >
                {busy ? t('rdSavingButton') : t('rdNoticeExtendSubmit')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/*
        BATCH 5 GROUP 7c — CONDITION 3: RETRIEVAL FROM THE BLOCKED PHASE.

        Gated on `retention.archive.retrieve` ALONE, not on the any-of above: this is a capability a
        holder of `retention.dispose.nominate` does not have, and admitting either would make the
        narrower code decorative. A reader without it sees no section at all rather than a refusal —
        they came to this screen for the schedule or the batches, and a sentence about a capability
        they were never offered is noise. The notice section above still tells them what the blocked
        phase IS.
      */}
      {canRetrieve ? (
        <section style={sectionStyle} data-testid="retention-retrieve-section">
          <h2>{t('rdRetrieveHeading')}</h2>
          <p role="status" style={{ color: 'var(--ink-secondary)' }}>
            {t('rdRetrieveAppendOnly')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRetrieveDone(false);
              void run(async () => {
                await retrieveBlockedRecords({
                  recordCategory: retrieveCategory.trim(),
                  // Split on commas and whitespace, blanks dropped: an officer pastes a list out of
                  // a court letter, and a trailing comma must not become an empty record id the
                  // server then refuses by name for a reason nobody can see.
                  recordIds: retrieveIds
                    .split(/[\s,]+/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                  basis: retrieveBasis,
                  note: retrieveNote.trim(),
                });
                setRetrieveIds('');
                setRetrieveNote('');
                setRetrieveDone(true);
              });
            }}
            style={{ display: 'grid', gap: '0.75rem', maxWidth: '40rem' }}
          >
            <label>
              {/*
                ITS OWN LABEL, not the notice table's COLUMN HEADING — which is what the first
                version used, and it was wrong twice over. Decision 21: a label says what the field
                is FOR, and "Record category" is the name of a column. And it made an EXISTING
                locator ambiguous — the schedule form above has a field with that accessible name,
                so a sibling test resolved to two elements. Fixed at the cause rather than by
                scoping the other test around it.
              */}
              {t('rdRetrieveCategoryLabel')}
              <input
                data-testid="retrieve-category"
                value={retrieveCategory}
                onChange={(e) => setRetrieveCategory(e.target.value)}
                required
                style={{ width: '100%' }}
              />
            </label>
            <label>
              {t('rdRetrieveRecordsLabel')}
              <textarea
                data-testid="retrieve-records"
                value={retrieveIds}
                onChange={(e) => setRetrieveIds(e.target.value)}
                required
                rows={2}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              {t('rdRetrieveBasisLabel')}
              <select
                data-testid="retrieve-basis"
                aria-label={t('rdRetrieveBasisLabel')}
                value={retrieveBasis}
                onChange={(e) =>
                  setRetrieveBasis(e.target.value as ArchiveRetrievalBasis)
                }
                style={{ width: '100%' }}
              >
                {/*
                  A CLOSED TWO, and there is deliberately no "internal review" option: an office
                  retrieving a blocked record for its own purposes is not retrieving it on a basis,
                  it is processing it — which is what condition 1 refuses.
                */}
                <option value="JUDICIAL_REQUEST">
                  {t('rdRetrieveBasisJudicial')}
                </option>
                <option value="CBJ_AUDIT">{t('rdRetrieveBasisCbj')}</option>
              </select>
            </label>
            <label>
              {t('rdRetrieveNoteLabel')}
              <textarea
                data-testid="retrieve-note"
                value={retrieveNote}
                onChange={(e) => setRetrieveNote(e.target.value)}
                required
                rows={2}
                style={{ width: '100%' }}
              />
            </label>
            <button type="submit" disabled={busy} data-testid="retrieve-submit">
              {busy ? t('rdSavingButton') : t('rdRetrieveSubmit')}
            </button>
          </form>
          {retrieveDone ? (
            <p role="status" data-testid="retrieve-done">
              {t('rdRetrieveDone')}
            </p>
          ) : null}

          <h3>{t('rdRetrieveRegisterHeading')}</h3>
          {retrievals === null ? (
            <p>{t('rdLoading')}</p>
          ) : retrievals.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>
              {t('rdRetrieveNone')}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                data-testid="retrieve-register-table"
                style={{ borderCollapse: 'collapse', width: '100%' }}
              >
                <thead>
                  <tr>
                    <th style={head}>{t('rdNoticeColCategory')}</th>
                    <th style={head}>{t('rdRetrieveColBasis')}</th>
                    <th style={head}>{t('rdRetrieveColNote')}</th>
                    <th style={head}>{t('rdRetrieveColWho')}</th>
                    <th style={head}>{t('rdRetrieveColWhen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {retrievals.map((r) => (
                    <tr key={r.id} data-retrieval-for={r.recordId}>
                      <td style={cell}>{r.recordCategory}</td>
                      {/*
                        THE RECORD'S OWN ID IS NOT RENDERED, and that is rule 2 rather than an
                        omission. The identifier-budget guard fired on the first version (29 -> 30)
                        and its own message names the right move: a uuid identifies nothing to a
                        person, so give the record something readable — and where the payload has
                        none, that is an API change and a decision rather than a display fix.
                        MEASURED: of the four blockable models only `Receipt.reference` and
                        `CommissionLedgerEntry.paymentReference` carry anything readable at all;
                        `Remittance` and `Settlement` carry nothing. So what identifies a RETRIEVED
                        record to a person joins rule 2's deferred family (register entry 94).
                        The id is still in the register row and in the api response, so the
                        accountability the register exists for is intact; what is missing is a
                        readable handle for the person reading it, and inventing one would be the
                        display fix the rule refuses. The row keeps it as a test hook, which is an
                        attribute and not text a reader sees.
                      */}
                      <td style={cell}>
                        {r.basis === 'JUDICIAL_REQUEST'
                          ? t('rdRetrieveBasisJudicial')
                          : t('rdRetrieveBasisCbj')}
                      </td>
                      <td style={cell}>{r.note}</td>
                      <td style={cell}>{r.retrievedByName ?? '—'}</td>
                      <td style={cell}>{r.retrievedAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section style={sectionStyle}>
        <h2>{t('rdScheduleHeading')}</h2>
        {canManageSchedule ? (
          <form
            onSubmit={submitSchedule}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdRecordCategoryLabel')}
              <input
                aria-label={t('rdRecordCategoryLabel')}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdRetentionMonthsLabel')}
              <input
                aria-label={t('rdRetentionMonthsLabel')}
                type="number"
                min={1}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdLegalBasisLabel')}
              <input
                aria-label={t('rdColLegalBasis')}
                value={legalBasis}
                onChange={(e) => setLegalBasis(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('rdSavingButton') : t('rdAddCategoryButton')}
            </button>
          </form>
        ) : null}
        {/*
          THE DECLARATION, batch 5 group 6. Shown only when the SERVER asked — this screen holds no
          copy of the floor list, deliberately, because a copy is a second home for the rule and the
          copy is the one that drifts.

          `role="status"` and not `alert`: the period is ACCEPTED and the office is being asked to
          record why it chose it. An alert would report an acceptance as a failure.
        */}
        {noFloorAsk ? (
          <div
            role="status"
            data-testid="retention-no-floor-declaration"
            style={{
              margin: '0.75rem 0',
              padding: '0.75rem',
              border: '1px solid var(--border-default)',
              borderRadius: '0.25rem',
              background: 'var(--surface-raised)',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem' }}>{t('rdNoFloorHeading')}</h3>
            {/* The owner's sentence, rendered verbatim and sent back verbatim to be recorded. */}
            <p style={{ margin: '0 0 0.75rem' }} data-testid="retention-no-floor-notice">
              {noFloorNotice}
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdNoFloorReasonLabel')}
              <textarea
                aria-label={t('rdNoFloorReasonLabel')}
                rows={3}
                style={{ width: '100%' }}
                value={noFloorReason}
                onChange={(e) => setNoFloorReason(e.target.value)}
              />
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                margin: '0.5rem 0',
              }}
            >
              <input
                type="checkbox"
                checked={noFloorAcknowledged}
                onChange={(e) => setNoFloorAcknowledged(e.target.checked)}
              />
              {t('rdNoFloorAcknowledgeLabel')}
            </label>
            {noFloorReason.trim().length > 0 &&
            noFloorReason.trim().length < NO_FLOOR_REASON_MIN_LENGTH ? (
              <p style={{ margin: '0 0 0.5rem', color: 'var(--ink-secondary)' }}>
                {t('rdNoFloorReasonTooShort')}
              </p>
            ) : null}
            <button
              type="button"
              /*
                Disabled until the tick AND the ten characters, so this screen never sends a request
                it already knows the server will refuse — the rule `CombinedDutyReasonField` follows.
              */
              disabled={
                busy ||
                !noFloorAcknowledged ||
                noFloorReason.trim().length < NO_FLOOR_REASON_MIN_LENGTH
              }
              onClick={() => {
                if (noFloorAsk.key === 'new') {
                  void submitSchedule({
                    preventDefault: () => undefined,
                  } as React.FormEvent);
                } else {
                  void runOrAsk(noFloorAsk, () =>
                    updateRetentionScheduleItem(noFloorAsk.key, {
                      retentionPeriodMonths: noFloorAsk.months,
                      noFloorDeclaration: noFloorDeclarationPayload(),
                    }),
                  );
                }
              }}
            >
              {busy ? t('rdSavingButton') : t('rdNoFloorSaveButton')}
            </button>
          </div>
        ) : null}
        {schedule ? (
          schedule.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoScheduleItems')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                data-testid="retention-schedule-table" style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdColCategory')}</th>
                    <th style={head}>{t('rdColMonths')}</th>
                    <th style={head}>{t('rdColLegalBasis')}</th>
                    <th style={head}>{t('rdColConfirmed')}</th>
                    <th style={head}>{t('rdColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((s) => (
                    <tr key={s.id}>
                      <td style={cell}>{s.recordCategory}</td>
                      <td style={cell}>
                        {canManageSchedule && !s.isConfirmed ? (
                          <input
                            aria-label={t('rdMonthsAria', { name: s.recordCategory })}
                            style={{ width: '5rem' }}
                            value={
                              editMonths[s.id] ??
                              (s.retentionPeriodMonths === null
                                ? ''
                                : String(s.retentionPeriodMonths))
                            }
                            onChange={(e) =>
                              setEditMonths((m) => ({ ...m, [s.id]: e.target.value }))
                            }
                          />
                        ) : (
                          s.retentionPeriodMonths
                        )}
                        {/*
                          NO PERIOD SET — and this is the shipped state for a floored category, not
                          an error. The office is shown the ARTICLE and the FLOOR where the number
                          would be, which is what makes it actionable: "no period yet, and here is
                          the minimum the law requires" is something to act on where a blank is not.

                          Decision 32's reason is why the number is absent in the first place: a
                          period shipped beside an article number would read as a legal opinion from
                          us, and we do not have one.
                        */}
                        {s.retentionPeriodMonths === null ? (
                          <span
                            style={{ display: 'block', color: 'var(--ink-muted)' }}
                            data-no-period={s.recordCategory}
                          >
                            {t('rdNoPeriodSet')}
                            {s.floor === null ? null : (
                              <>
                                {' — '}
                                {t('rdFloorApplies', {
                                  article: `${s.floor.instrument}, ${s.floor.article}`,
                                  months: String(s.floor.floorMonths),
                                })}
                              </>
                            )}
                            {' '}
                            {t('rdInertNothingMeasured')}
                          </span>
                        ) : null}
                      </td>
                      <td style={cell}>{s.legalBasis ?? '—'}</td>
                      <td style={cell}>
                        {/* `commonYes`, not a hardcoded 'Yes' — an Arabic reader was seeing the
                            English word in this cell. The key already existed in both languages. */}
                        {s.isConfirmed ? t('commonYes') : t('rdDraftPending')}
                        {/* THE ACT, ON THE RECORD — in the CONFIRMED column, because the
                            confirmation is the half it excuses and that is the cell a reader
                            asking "who confirmed this" is already looking at. Renders nothing
                            when there is no act, which is nearly every row. */}
                        <CombinedDutyOnRecord
                          act={s.combinedDutyAct}
                          testId={`retention-schedule-combined-duty-${s.id}`}
                        />
                      </td>
                      <td style={cell}>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          {canManageSchedule && !s.isConfirmed && editMonths[s.id] ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runOrAsk(
                                  {
                                    key: s.id,
                                    recordCategory: s.recordCategory,
                                    months: Number(editMonths[s.id]),
                                  },
                                  () =>
                                    updateRetentionScheduleItem(s.id, {
                                      retentionPeriodMonths: Number(
                                        editMonths[s.id],
                                      ),
                                      ...(noFloorAsk?.key === s.id
                                        ? {
                                            noFloorDeclaration:
                                              noFloorDeclarationPayload(),
                                          }
                                        : {}),
                                    }),
                                )
                              }
                            >
                              {t('rdSaveButton')}
                            </button>
                          ) : null}
                          {canManageSchedule && !s.isConfirmed ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => confirmRetentionScheduleItem(s.id))
                              }
                            >
                              {t('rdConfirmButton')}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loadError ? null : (
          <p>{t('rdLoading')}</p>
        )}
      </section>

      {/* --- Legal holds --- */}
      <section style={sectionStyle}>
        <h2>{t('rdHoldsHeading')}</h2>
        {canManageHolds ? (
          <form
            onSubmit={submitHold}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdScopeFieldLabel')}
              <input
                aria-label={t('rdScopeAria')}
                value={holdScope}
                onChange={(e) => setHoldScope(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdReasonLabel')}
              <input
                aria-label={t('rdReasonAria')}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdHoldCategoryIdLabel')}
              <input
                aria-label={t('rdHoldCategoryIdAria')}
                value={holdCategoryId}
                onChange={(e) => setHoldCategoryId(e.target.value)}
              />
            </label>
            <EntitySearch
            kind="customer"
              value={holdCustomerId}
              onChange={setHoldCustomerId}
              label={t('rdHoldCustomerIdLabel')}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdHoldInsuredPersonIdLabel')}
              <input
                aria-label={t('rdHoldInsuredPersonIdAria')}
                value={holdInsuredPersonId}
                onChange={(e) => setHoldInsuredPersonId(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('commonSaving') : t('rdPlaceHoldButton')}
            </button>
          </form>
        ) : null}
        {holds ? (
          holds.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoHolds')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdScopeLabel')}</th>
                    <th style={head}>{t('rdColCategory')}</th>
                    <th style={head}>{t('rdColSubject')}</th>
                    <th style={head}>{t('rdColNextReviewDue')}</th>
                    <th style={head}>{t('rdColStatus')}</th>
                    <th style={head}>{t('rdColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {holds.map((h) => (
                    <tr key={h.id}>
                      <td style={cell}>{h.scope}</td>
                      <td style={cell}>
                        {h.retentionScheduleItemId ? h.retentionScheduleItemId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={cell}>
                        {h.customerId
                          ? `Customer ${h.customerId.slice(0, 8)}…`
                          : h.insuredPersonId
                            ? t('rdInsuredPersonGeneric')
                            : '—'}
                      </td>
                      <td style={cell}>{h.nextReviewDueAt.slice(0, 10)}</td>
                      <td style={cell}>{h.isActive ? 'Active' : t('rdReleased')}</td>
                      <td style={cell}>
                        {canManageHolds && h.isActive ? (
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => reviewLegalHold(h.id))}
                            >
                              {t('rdRecordReviewButton')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => releaseLegalHold(h.id))}
                            >
                              {t('rdReleaseButton')}
                            </button>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loadError ? null : (
          <p>{t('rdLoading')}</p>
        )}
      </section>

      {/* --- Disposal batches --- */}
      <section style={sectionStyle}>
        <h2>{t('rdBatchesHeading')}</h2>
        {canNominate ? (
          <form
            onSubmit={submitNominate}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdBatchCategoryIdFieldLabel')}
              <input
                aria-label={t('rdBatchCategoryIdLabel')}
                value={nominateCategoryId}
                onChange={(e) => setNominateCategoryId(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('commonSaving') : t('rdNominateBatchButton')}
            </button>
          </form>
        ) : null}
        {batches ? (
          batches.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoBatches')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdColCategory')}</th>
                    <th style={head}>{t('rdColStatus')}</th>
                    <th style={head}>{t('rdColSlaDue')}</th>
                    <th style={head}>{t('rdColCertificate')}</th>
                    <th style={head}>{t('rdColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td style={cell}>
                        {b.retentionScheduleItemId ? b.retentionScheduleItemId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={cell}>
                        {t(ENUM_LABEL.DisposalBatchStatus[b.status])}
                        {/* Part 4 step 5 — in the STATUS cell, because the status says DPO_APPROVED
                            whether one person or two agreed, and this pair authorises irreversible
                            destruction of personal data. Shared renderer. */}
                        <CombinedDutyOnRecord
                          act={b.combinedDutyAct}
                          testId={`combined-duty-disposal-${b.id}`}
                        />
                      </td>
                      <td style={cell}>{b.slaDueAt ? b.slaDueAt.slice(0, 10) : '—'}</td>
                      <td style={cell}>{b.hasCertificateOfDestruction ? t('rdAttached') : '—'}</td>
                      <td style={cell}>
                        {/* Owner decision 41 — this batch's state history, without a pasted uuid.
                            Outside the CLOSED ternary deliberately: a CLOSED batch is exactly the one
                            whose history somebody comes to read, and the branch below renders an
                            em-dash for it. Renders nothing without `workflow-history.read`. */}
                        <div style={{ marginBottom: '0.4rem' }}>
                          <WorkflowHistoryLink
                            entityType="DisposalBatch"
                            entityId={b.id}
                          />
                        </div>
                        {b.status === 'CLOSED' ? (
                          '—'
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', minWidth: '18rem' }}>
                            {canNominate && b.status === 'NOMINATED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => managerApproveDisposalBatch(b.id))}
                              >
                                {t('rdManagerApproveButton')}
                              </button>
                            ) : null}
                            {canApprove && b.status === 'MANAGER_APPROVED' ? (
                              (() => {
                                // Part 4 — the person who performed the first half may complete it themselves in an office
                                // that has declared COMBINED, only by saying why. Every other case is unchanged.
                                const needs = needsCombinedDutyDeclaration({
                                  mode: user.dutySegregationMode,
                                  makerUserId: b.nominatedByUserId,
                                  currentUserId: user.id,
                                  alreadyDecided: b.dpoApprovedByUserId != null,
                                });
                                const declaration = declarations[b.id] ?? '';
                                return (
                                  <>
                                    {needs ? (
                                      <CombinedDutyReasonField
                                        id={b.id}
                                        value={declaration}
                                        onChange={(next) =>
                                          setDeclarations((prev) => ({ ...prev, [b.id]: next }))
                                        }
                                      />
                                    ) : null}
                                    <button
                                      type="button"
                                      disabled={busy || (needs && combinedDutyTooShort(declaration))}
                                      onClick={() =>
                                        void run(() =>
                                          dpoApproveDisposalBatch(b.id, needs ? declaration.trim() : undefined),
                                        )
                                      }
                                    >
                                      {t('rdDpoApproveButton')}
                                    </button>
                                  </>
                                );
                              })()
                            ) : null}
                            {canApprove && b.status === 'DPO_APPROVED' ? (
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <select
                                  aria-label={t('rdDestructionMethodAria')}
                                  value={method}
                                  onChange={(e) => setMethod(e.target.value)}
                                >
                                  {DISPOSAL_METHODS.map((m) => (
                                    <option key={m} value={m}>
                                      {t(ENUM_LABEL.DisposalMethod[m])}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void run(() => executeDisposalBatch(b.id, method))}
                                >
                                  {t('rdRecordExecutionButton')}
                                </button>
                              </div>
                            ) : null}
                            {canApprove && b.status === 'EXECUTED' && !b.hasCertificateOfDestruction ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => issueCertificateOfDestruction(b.id))}
                              >
                                {t('rdIssueCertificateButton')}
                              </button>
                            ) : null}
                            {canApprove && b.status === 'EXECUTED' && b.hasCertificateOfDestruction ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeDisposalBatch(b.id))}
                              >
                                {t('rdCloseButton')}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loadError ? null : (
          <p>{t('rdLoading')}</p>
        )}
      </section>
    </main>
  );
}
