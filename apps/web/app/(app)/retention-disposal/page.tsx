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
import type { TranslationKey } from '../../../lib/i18n/translations';
// TEN, imported rather than written again. The api holds this figure in exactly one place
// (`common/declaration-reason.ts`) and the owner's instruction was that two minimums for one
// concept is the drift we keep paying for — which applies across the boundary too.
import {
  NO_FLOOR_REASON_MIN_LENGTH,
  extendRetention,
  listRetentionNotices,
  listArchiveRetrievals,
  listArchiveRetrievalBases,
  listRetentionExtensions,
  retrieveBlockedRecords,
  type ArchiveRetrieval,
  type ArchiveRetrievalBasis,
  type ArchiveRetrievalBasisDefinition,
  type ExtendRetentionInput,
  type RetentionExtensionRegisterRow,
  type RetentionNotice,
} from '../../../lib/pdpl/retention-disposal-api';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
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

/**
 * THE WORD FOR EACH RETRIEVAL BASIS, AND WHAT HAPPENS TO A BASIS WITH NO WORD.
 *
 * The LIST of bases now comes from `GET /retention-archive/bases` — the screen no longer carries a
 * copy of the closed two — and the WORDS stay here, keyed by member. That split is the point: a
 * third basis added server-side appears in the dropdown without a web change, and its label is the
 * only thing that has to be decided.
 *
 * `satisfies` over the union keeps the compile-time half: a third member added to
 * `ArchiveRetrievalBasis` is a build error until it is named. The DECLARED type is a partial map
 * over `string`, which is the runtime truth — the server may send a member this build has never
 * heard of — so the lookup needs no cast to be honest about it.
 */
/**
 * THE WORD FOR EACH EXTENSION BASIS. A TOTAL map, unlike the archive one below, and the difference
 * is where the list lives: the three extension bases are a closed union this build owns — the api's
 * DTO validates against exactly them and the extend form renders a different field for each — so a
 * fourth is a build error here rather than something that can arrive over HTTP. No fallback is
 * reachable, which is why this one has none.
 */
const EXTENSION_BASIS_LABEL = {
  LEGISLATIVE_PROVISION: 'rdNoticeBasisLegislative',
  LEGAL_HOLD_OR_DISPUTE: 'rdNoticeBasisHold',
  CUSTOMER_EXPLICIT_CONSENT: 'rdNoticeBasisConsent',
} satisfies Record<ExtendRetentionInput['basis'], TranslationKey>;

const ARCHIVE_BASIS_LABEL: Partial<Record<string, TranslationKey>> = {
  JUDICIAL_REQUEST: 'rdRetrieveBasisJudicial',
  CBJ_AUDIT: 'rdRetrieveBasisCbj',
  AMLU_REQUEST: 'rdRetrieveBasisAmlu',
  OTHER: 'rdRetrieveBasisOther',
} satisfies Record<ArchiveRetrievalBasis, TranslationKey>;

/**
 * WHAT EACH BASIS MEANS — owner decision 45. Her texts, and the shape is HERS rather than one
 * string: a `when` that states the SELECTION CONDITION (which is what actually helps somebody
 * choose, where a definition does not), a `write` saying what goes in the box, and an `example`
 * whose shape is meant to be copied. Her brief's own instruction was to extend the shape rather than
 * cram three parts into one line with separators, and rather than drop the example.
 *
 * `kinds` IS PRESENT ON `OTHER` ALONE and is not padding: that basis lists six kinds before it says
 * what to write, and folding them into `when` would bury the list the list exists to be.
 *
 * Declared `Partial` over `string` and `satisfies` the UNION — the `ARCHIVE_BASIS_LABEL` pattern
 * directly above, and for the same two reasons. A fifth basis added server-side is a build error
 * here until its words are decided, and until then the lookup is honestly empty rather than
 * rendering `undefined` through `t()`, which renders nothing at all.
 */
const ARCHIVE_BASIS_MEANING: Partial<
  Record<
    string,
    {
      when: TranslationKey;
      kinds?: TranslationKey;
      write: TranslationKey;
      example: TranslationKey;
    }
  >
> = {
  JUDICIAL_REQUEST: {
    when: 'rdRetrieveWhenJudicial',
    write: 'rdRetrieveWriteJudicial',
    example: 'rdRetrieveEgJudicial',
  },
  CBJ_AUDIT: {
    when: 'rdRetrieveWhenCbj',
    write: 'rdRetrieveWriteCbj',
    example: 'rdRetrieveEgCbj',
  },
  AMLU_REQUEST: {
    when: 'rdRetrieveWhenAmlu',
    write: 'rdRetrieveWriteAmlu',
    example: 'rdRetrieveEgAmlu',
  },
  OTHER: {
    when: 'rdRetrieveWhenOther',
    kinds: 'rdRetrieveKindsOther',
    write: 'rdRetrieveWriteOther',
    example: 'rdRetrieveEgOther',
  },
} satisfies Record<
  ArchiveRetrievalBasis,
  { when: TranslationKey; kinds?: TranslationKey; write: TranslationKey; example: TranslationKey }
>;

/*
 * The basis explanation. A bordered block rather than muted body text, deliberately: it is four
 * sentences in a form and has to read as guidance attached to the field above it rather than as
 * small print. No `opacity` and no muted ink — that pair is what produced this app's only a11y
 * contrast regression, and the text here is the instruction somebody is meant to follow.
 */
const basisMeaningStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  padding: '0.6rem 0.75rem',
  border: '1px solid var(--border-subtle)',
  borderRadius: '6px',
  /*
   * `--surface-sunken`, which is now the one answer for this shape. Batch five recorded that three
   * other sites referenced `--surface-raised`, a property `globals.css` defines NOWHERE, so all
   * three rendered with no background at all — a bare `var()` on an undefined property drops the
   * whole declaration. Batch six closed that (owner's instruction) by pointing those three here
   * rather than defining a fifth surface: all four blocks are the same job, an inset notice on a
   * card, which is what `--surface-sunken` already means. `undefined-css-properties.py` is the
   * gate that can see the class at all.
   */
  background: 'var(--surface-sunken)',
  fontSize: '0.9rem',
  lineHeight: 1.6,
};


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
  const [extensions, setExtensions] = useState<
    RetentionExtensionRegisterRow[] | null
  >(null);
  const [bases, setBases] = useState<ArchiveRetrievalBasisDefinition[] | null>(
    null,
  );
  const [retrieveCategory, setRetrieveCategory] = useState('');
  const [retrieveIds, setRetrieveIds] = useState('');
  /*
   * EMPTY UNTIL THE SERVER SAYS WHICH BASES EXIST. It used to be `'JUDICIAL_REQUEST'`, which was
   * the screen's own second copy of a closed vocabulary the route already answers for — and the
   * route existed for exactly that reason and had no caller. A `string` rather than the union for
   * the same reason the client's `basis` field is: a basis this build has not heard of must still
   * be selectable, not typed out of existence.
   */
  const [retrieveBasis, setRetrieveBasis] = useState<string>('');
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
       * THE EXTENSION REGISTER, gated the same ANY-OF as the notice above and so conditional on it.
       *
       * It sits beside the notice rather than inside it because it is NOT the same list: the notice
       * returns records whose period has ELAPSED, and an extended record leaves that list by design.
       * Until this read existed an office could extend retention and nobody could see what had been
       * extended or why — the write recorded all of it faithfully and nothing read it back.
       */
      ...(canSeeNotices
        ? [
            {
              key: 'extensions',
              label: t('rdExtRegisterHeading'),
              load: listRetentionExtensions,
            },
          ]
        : []),
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
            /*
             * WHICH BASES EXIST, from the route that was written so the screen would not restate
             * them. Same gate as the retrieval itself, so it joins the same conditional block.
             */
            {
              key: 'bases',
              label: t('rdRetrieveBasisLabel'),
              load: listArchiveRetrievalBases,
            },
          ]
        : []),
    ]);
    setSchedule((values.schedule as RetentionScheduleItem[] | undefined) ?? null);
    setHolds((values.holds as LegalHold[] | undefined) ?? null);
    setBatches((values.batches as DisposalBatch[] | undefined) ?? null);
    setNotices((values.notices as RetentionNotice[] | undefined) ?? null);
    setRetrievals((values.retrievals as ArchiveRetrieval[] | undefined) ?? null);
    setExtensions(
      (values.extensions as RetentionExtensionRegisterRow[] | undefined) ?? null,
    );
    const loadedBases =
      (values.bases as ArchiveRetrievalBasisDefinition[] | undefined) ?? null;
    setBases(loadedBases);
    /*
     * A FUNCTIONAL UPDATE, so a basis the officer has already chosen survives the reload every
     * action triggers. Only a value the server no longer offers is replaced, and the fallback is
     * the first basis the server named rather than a literal — which is the whole point of reading
     * the list. Empty while the list has not arrived, and the submit is disabled on that.
     */
    setRetrieveBasis((current) => {
      if (loadedBases === null) return current;
      const offered = loadedBases.map((b) => b.basis);
      return offered.includes(current) ? current : (offered[0] ?? '');
    });
    const allRefused =
      // THE THRESHOLD MOVES WITH THE PANEL COUNT, which is what this comment demanded when it read
      // "4, not 3", and again when it read "five lists". It is COMPUTED rather than written because
      // the panel count depends on two permissions now. Decision 43 added
      // the extension register (on the notice's own any-of) and the basis list (on the retrieval's
      // code), so a reader holding none of the codes fails four and a reader holding all of them
      // fails seven — and a literal would make the all-of sentence unreachable for all but one
      // kind of reader. This is the second time that comment has had to be honoured.
      failures.length ===
        4 + (canRetrieve ? 2 : 0) + (canSeeNotices ? 1 : 0) &&
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
  }, [t, canRetrieve, canSeeNotices]);

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
  /**
   * THE WORD FOR A BASIS, or the basis itself when this build has no word for it.
   *
   * One helper for both readers of a basis — the retrieval form's `<select>` and the retrieval
   * register's own table — because they used to disagree: the table was a ternary on one member, so
   * ANY other basis rendered the Central Bank audit label. A third basis would have been reported on
   * the register as an audit that never happened.
   *
   * The fallback renders the member NAME rather than nothing. `t(undefined)` renders nothing at all
   * — the notification-bell defect — and an English member name in an Arabic dropdown is obviously
   * unfinished, where a blank option is indistinguishable from a bug. Same decision the eighteen
   * workflow-entity labels made for a member with no word.
   */
  const basisLabel = (basis: string): string => {
    const key = ARCHIVE_BASIS_LABEL[basis];
    return key ? t(key) : basis;
  };

  /*
   * The chosen basis's own words, or nothing. `undefined` on both the no-choice-yet state and on a
   * basis whose words have not been decided — the two are the same thing to render (no block), and
   * keeping them one expression is what stops a half-written `aria-describedby` pointing at an id
   * that is not there.
   */
  const chosenBasisMeaning =
    retrieveBasis === '' ? undefined : ARCHIVE_BASIS_MEANING[retrieveBasis];

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
    <main style={pageStackStyle}>
      <PageHeader title={t('rdHeading')} description={t('rdIntro')} />

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
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
        <Card title={t('rdNoticeHeading')}>
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
            <EmptyState title={t('rdNoticeNone')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('rdNoticeColCategory')}</Th>
                  <Th>{t('rdNoticeColElapsed')}</Th>
                  <Th>{t('rdNoticeColBasis')}</Th>
                  <Th>{t('rdNoticeColCountedFrom')}</Th>
                  <Th>{t('rdNoticeColChoices')}</Th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n) => (
                  <Tr key={n.recordCategory} data-notice-for={n.recordCategory}>
                    <Td>{n.recordCategory}</Td>
                    <Td>
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
                    </Td>
                    <Td>
                      {n.floor
                        ? `${n.floor.instrument}, ${n.floor.article} — ${n.floor.operativeText}`
                        : '—'}
                    </Td>
                    <Td>{n.countedFrom ?? '—'}</Td>
                    <Td>
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
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
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
              <h3>
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
        </Card>
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
        <Card title={t('rdRetrieveHeading')} data-testid="retention-retrieve-section">
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
                onChange={(e) => setRetrieveBasis(e.target.value)}
                disabled={bases === null || bases.length === 0}
                /*
                 * Pointed at the meaning block only when there IS one — an `aria-describedby` naming
                 * an id that is not in the document is itself a violation, and a basis whose words
                 * nobody has written yet has no block to name.
                 */
                aria-describedby={
                  chosenBasisMeaning ? 'rd-retrieve-basis-meaning' : undefined
                }
                style={{ width: '100%' }}
              >
                {/*
                  THE OPTIONS COME FROM THE SERVER — four of them since owner decision 45, and the
                  list is no longer the closed two. WHERE the list lives is the server's; this screen
                  used to carry its own copy.

                  AND DECISION 45 REVERSES A RECORDED DECISION, STATED RATHER THAN SMOOTHED OVER.
                  This comment used to read *"a closed two with deliberately no internal review among
                  them: an office retrieving a blocked record for its own purposes is not retrieving
                  it on a basis, it is processing it"*. `OTHER` now lists an internal review and the
                  office's own annual auditor among its kinds, so that rule has moved and the owner
                  moved it. What makes the new position the stronger one is the `note` floor: an
                  office that needs a blocked file for an internal review retrieves it either way,
                  and a list with no slot for that leaves the retrieval recorded under a basis that
                  never happened — a judicial request nobody made. A declared internal reason, with
                  its note, is answerable; a mislabelled one is worse than either.

                  `OTHER` IS STILL NOT FREE TEXT AS A BASIS. It is a declared KIND of compulsion and
                  `note` is NOT NULL for every basis, carrying the shared declaration-reason floor —
                  so it cannot be selected without saying what the reason was.

                  NO PLACEHOLDER OPTION AND NO "loading" TEXT. An empty disabled select is honest in
                  both the not-yet and the did-not-load states, where a word would have to pick one
                  of them and would be a wrong claim in the other; the named-failure sentence at the
                  top of the screen is what says the list did not arrive.
                */}
                {(bases ?? []).map((b) => (
                  <option key={b.basis} value={b.basis}>
                    {basisLabel(b.basis)}
                  </option>
                ))}
              </select>
            </label>
            {/*
              THE CHOSEN BASIS EXPLAINS ITSELF, BETWEEN THE SELECT AND THE BOX IT IS ABOUT. Owner
              decision 45: a reader who has just chosen *a judicial request* is one field away from
              the note, and what they need there is not a definition of the phrase but the three
              things she wrote — when this is the right choice, what goes in the box, and an example
              whose shape they can copy.

              THE SHARED LINE RENDERS UNDER ALL FOUR and is not repeated per basis, because it is
              one fact about every retrieval rather than four: this file left the archive after its
              period had ended, and the note is the office's answer if it is asked later.
            */}
            {chosenBasisMeaning ? (
              <div
                id="rd-retrieve-basis-meaning"
                role="note"
                data-testid="retrieve-basis-meaning"
                data-basis={retrieveBasis}
                style={basisMeaningStyle}
              >
                <p style={{ margin: '0 0 0.4rem' }}>{t(chosenBasisMeaning.when)}</p>
                {chosenBasisMeaning.kinds ? (
                  <p style={{ margin: '0 0 0.4rem' }}>{t(chosenBasisMeaning.kinds)}</p>
                ) : null}
                <p style={{ margin: '0 0 0.4rem' }}>{t(chosenBasisMeaning.write)}</p>
                <p style={{ margin: '0 0 0.4rem' }} data-basis-example="">
                  {t(chosenBasisMeaning.example)}
                </p>
                <p style={{ margin: 0 }} data-basis-shared="">
                  {t('rdRetrieveBasisShared')}
                </p>
              </div>
            ) : null}
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
            <button
              type="submit"
              disabled={busy || retrieveBasis === ''}
              data-testid="retrieve-submit"
            >
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
            <SkeletonList rows={3} label={t('rdLoading')} />
          ) : retrievals.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>
              {t('rdRetrieveNone')}
            </p>
          ) : (
            <Table data-testid="retrieve-register-table">
              <thead>
                <tr>
                  <Th>{t('rdNoticeColCategory')}</Th>
                  <Th>{t('rdRetrieveColBasis')}</Th>
                  <Th>{t('rdRetrieveColNote')}</Th>
                  <Th>{t('rdRetrieveColWho')}</Th>
                  <Th>{t('rdRetrieveColWhen')}</Th>
                </tr>
              </thead>
              <tbody>
                {retrievals.map((r) => (
                  <Tr key={r.id} data-retrieval-for={r.recordId}>
                    <Td>{r.recordCategory}</Td>
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
                    {/*
                      THE SAME LOOKUP THE SELECT USES. This was a ternary on one member, so any
                      basis that was not `JUDICIAL_REQUEST` rendered the CBJ-audit label — a third
                      basis would have been mislabelled as a Central Bank audit on the register
                      that exists to say why a blocked record was opened.
                    */}
                    <Td>{basisLabel(r.basis)}</Td>
                    <Td>{r.note}</Td>
                    <Td>{r.retrievedByName ?? t('commonNameNotResolved')}</Td>
                    <Td>{r.retrievedAt.slice(0, 10)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}

      {/*
        THE EXTENSION REGISTER — owner decision 43, and the one row of the triage that was a hole in
        something already declared closed.

        ## It is not the notice list, and that is why it had to exist

        `GET /retention-notices` returns records whose period has ELAPSED. An extended record LEAVES
        that list by design — that is what an extension does — so until this section existed an
        office could extend retention and nobody, a regulator asking *what did you extend and why*
        included, could see the list. The write path recorded the record, the basis, the note, the
        instrument and article and the legal hold faithfully, and nothing read any of it back.

        ## Gated on the notice's own any-of, and rendered for nobody else

        Holders of any of the three acts see the notice; the same three see what was extended. A
        reader without them gets no section at all rather than a refusal sentence — the frontend
        directive's rule, and the same treatment the retrieval section above gets.

        ## THE RECORD'S OWN ID IS NOT RENDERED, and that is rule 2 rather than an omission

        The owner's standing requirement is that the register must name WHICH records were extended,
        and the honest state of that is: the api returns `recordId` and this table does not show it.
        Measured for the retrieval register next door and unchanged here — of the four blockable
        models only `Receipt.reference` and `CommissionLedgerEntry.paymentReference` carry anything a
        person could recognise, and `Remittance` and `Settlement` carry nothing — so there is no
        readable handle to render, and inventing one is the display fix rule 2 refuses. Rendering the
        uuid would raise the rendered-identifier budget, which this batch is forbidden to do. The id
        is in the response and in each row's own `data-extension-for`, so the accountability the
        register exists for is intact; what is missing is a handle for the person reading it, and
        that is register entry 94's deferred family.
      */}
      {/* A CARD, like every other top-level section on this page — the retrieval register above
          is an `h3` INSIDE the retrieval card rather than a card of its own, which is what says it
          belongs to that section rather than standing beside it.

          THE COMMENT SITS ABOVE THE TERNARY, not inside its branch: a JSX comment as the first
          child of a branch is parsed as an OBJECT LITERAL, which is `TS1005` and three more errors
          downstream. Recorded in the pilot and met again here — and the fix for it then went wrong
          a second way, because a JSX comment cannot itself contain the two characters that end
          one, so quoting the shape inside the explanation closed the comment early. */}
      {canSeeNotices ? (
        <Card title={t('rdExtRegisterHeading')} data-testid="retention-extension-section">
          {extensions === null ? (
            <SkeletonList rows={3} label={t('rdLoading')} />
          ) : extensions.length === 0 ? (
            <p
              data-testid="retention-extension-none"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {t('rdExtRegisterNone')}
            </p>
          ) : (
            <Table data-testid="retention-extension-table">
              <thead>
                <tr>
                  <Th>{t('rdNoticeColCategory')}</Th>
                  <Th>{t('rdExtColRecord')}</Th>
                  <Th>{t('rdExtColUntil')}</Th>
                  <Th>{t('rdRetrieveColBasis')}</Th>
                  <Th>{t('rdRetrieveColNote')}</Th>
                  <Th>{t('rdNoticeInstrumentLabel')}</Th>
                  <Th>{t('rdNoticeArticleLabel')}</Th>
                  <Th>{t('rdNoticeHoldLabel')}</Th>
                  <Th>{t('rdExtColWho')}</Th>
                  <Th>{t('rdRetrieveColWhen')}</Th>
                </tr>
              </thead>
              <tbody>
                {extensions.map((x) => (
                  <Tr key={x.id} data-extension-for={x.recordId}>
                    {/*
                      WHICH RECORD — owner decision 44, and the id is STILL not rendered. The
                      reference is the real one the record carries (a client bank reference, a
                      commission payment reference), resolved by the api per category; where there
                      is none the cell says WHICH of the three reasons applies, because "nobody
                      wrote it down", "this kind of record has none" and "the record is gone" are
                      different answers to a regulator and an em dash is none of them.

                      The api's `description` rides along as a `title`, not as visible text: four
                      categories name four different kinds of reference and one column heading
                      cannot say which, but a cell crowded with that sentence stops being a
                      reference.
                    */}
                    <Td data-extension-handle={x.recordHandle.state}>
                      {x.recordHandle.state === 'RECORDED' ? (
                        <bdi title={x.recordHandle.description}>
                          {x.recordHandle.value}
                        </bdi>
                      ) : x.recordHandle.state === 'NOT_RECORDED' ? (
                        <span title={x.recordHandle.description}>
                          {t('rdExtRecordNotRecorded')}
                        </span>
                      ) : x.recordHandle.state === 'CATEGORY_HAS_NO_REFERENCE' ? (
                        <span title={x.recordHandle.reason}>
                          {t('rdExtRecordTypeNone')}
                        </span>
                      ) : (
                        t('rdExtRecordGone')
                      )}
                    </Td>
                    <Td>{x.recordCategory}</Td>
                    <Td>{x.extendedUntil.slice(0, 10)}</Td>
                    <Td>{t(EXTENSION_BASIS_LABEL[x.basis])}</Td>
                    <Td>{x.note}</Td>
                    {/*
                      An em dash rather than an omitted row where the basis did not need an
                      instrument: "this extension cites no statute" and "somebody left it blank"
                      are different facts, and a missing cell says neither.
                    */}
                    <Td>{x.legislativeInstrument ?? '—'}</Td>
                    <Td>{x.legislativeArticle ?? '—'}</Td>
                    {/*
                      THE HOLD'S SCOPE AND REASON, never its id — which is both rule 2 and the
                      useful half: a reader checking whether an extension is justified needs to
                      know WHAT was held and why, and a uuid tells them neither.
                    */}
                    <Td>
                      {x.legalHold === null
                        ? '—'
                        : `${x.legalHold.scope} — ${x.legalHold.reason}`}
                    </Td>
                    <Td>{x.extendedByName ?? t('commonNameNotResolved')}</Td>
                    <Td>{x.extendedAt.slice(0, 10)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}

      <Card title={t('rdScheduleHeading')}>
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
              /* was `--surface-raised`, which is defined nowhere — see the surfaces note in globals.css */
              background: 'var(--surface-sunken)',
            }}
          >
            <h3>{t('rdNoFloorHeading')}</h3>
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
            <EmptyState title={t('rdNoScheduleItems')} />
          ) : (
            <Table data-testid="retention-schedule-table">
              <thead>
                <tr>
                  <Th>{t('rdColCategory')}</Th>
                  <Th>{t('rdColMonths')}</Th>
                  <Th>{t('rdColLegalBasis')}</Th>
                  <Th>{t('rdColConfirmed')}</Th>
                  <Th>{t('rdColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <Tr key={s.id}>
                    <Td>{s.recordCategory}</Td>
                    <Td>
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
                    </Td>
                    <Td>{s.legalBasis ?? '—'}</Td>
                    <Td>
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
                    </Td>
                    <Td>
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
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : loadError ? null : (
          <SkeletonList rows={3} label={t('rdLoading')} />
        )}
      </Card>

      {/* --- Legal holds --- */}
      <Card title={t('rdHoldsHeading')}>
        {canManageHolds ? (
          <form
            onSubmit={submitHold}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdScopeAria')}
              <input
                value={holdScope}
                onChange={(e) => setHoldScope(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdReasonAria')}
              <input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdHoldCategoryIdAria')}
              <input
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
              {t('rdHoldInsuredPersonIdAria')}
              <input
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
            <EmptyState title={t('rdNoHolds')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('rdScopeLabel')}</Th>
                  <Th>{t('rdColCategory')}</Th>
                  <Th>{t('rdColSubject')}</Th>
                  <Th>{t('rdColNextReviewDue')}</Th>
                  <Th>{t('rdColStatus')}</Th>
                  <Th>{t('rdColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {holds.map((h) => (
                  <Tr key={h.id}>
                    <Td>{h.scope}</Td>
                    <Td>
                      {h.retentionScheduleItemId ? h.retentionScheduleItemId.slice(0, 8) + '…' : '—'}
                    </Td>
                    <Td>
                      {/*
                        * RULE 2 — WHOSE records are frozen, by name. This rendered
                        * `Customer <8 chars of a uuid>`, so a DPO working the six-monthly
                        * necessity review could not tell whose file each hold covers.
                        *
                        * The insured-person branch still renders its GENERIC label rather than a
                        * name: `InsuredPerson.fullName` exists, but that id is not among the 24
                        * this pass measures (the screen never rendered it), so resolving it is a
                        * widening nobody asked for and a disclosure decision of its own.
                        */}
                      {h.customerName ? (
                        <bdi>{h.customerName}</bdi>
                      ) : h.insuredPersonId ? (
                        t('rdInsuredPersonGeneric')
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>{h.nextReviewDueAt.slice(0, 10)}</Td>
                    <Td>{h.isActive ? t('rdHoldInForce') : t('rdReleased')}</Td>
                    <Td>
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
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : loadError ? null : (
          <SkeletonList rows={3} label={t('rdLoading')} />
        )}
      </Card>

      {/* --- Disposal batches --- */}
      <Card title={t('rdBatchesHeading')}>
        {canNominate ? (
          <form
            onSubmit={submitNominate}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdBatchCategoryIdLabel')}
              <input
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
            <EmptyState title={t('rdNoBatches')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('rdColCategory')}</Th>
                  <Th>{t('rdColStatus')}</Th>
                  <Th>{t('rdColSlaDue')}</Th>
                  <Th>{t('rdColCertificate')}</Th>
                  <Th>{t('rdColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <Tr key={b.id}>
                    <Td>
                      {b.retentionScheduleItemId ? b.retentionScheduleItemId.slice(0, 8) + '…' : '—'}
                    </Td>
                    <Td>
                      {t(ENUM_LABEL.DisposalBatchStatus[b.status])}
                      {/* Part 4 step 5 — in the STATUS cell, because the status says DPO_APPROVED
                          whether one person or two agreed, and this pair authorises irreversible
                          destruction of personal data. Shared renderer. */}
                      <CombinedDutyOnRecord
                        act={b.combinedDutyAct}
                        testId={`combined-duty-disposal-${b.id}`}
                      />
                    </Td>
                    <Td>{b.slaDueAt ? b.slaDueAt.slice(0, 10) : '—'}</Td>
                    <Td>{b.hasCertificateOfDestruction ? t('rdAttached') : '—'}</Td>
                    <Td>
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
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : loadError ? null : (
          <SkeletonList rows={3} label={t('rdLoading')} />
        )}
      </Card>
    </main>
  );
}
