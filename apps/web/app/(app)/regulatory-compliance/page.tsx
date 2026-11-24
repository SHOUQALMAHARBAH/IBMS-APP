'use client';

import { errorStyle } from '../../../components/auth/auth-form.styles';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createBrokerLicense,
  getBrokerLicense,
  recordRegulatoryAction,
  declareRenewalStanding,
  recordRenewalRequest,
  renewBrokerLicense,
  type BrokerLicense,
  type BrokerLicenseSeries,
} from '../../../lib/compliance-risk/broker-license-api';
import {
  addLicenseScopeBranch,
  getLicenseScope,
  removeLicenseScopeBranch,
  type LicenseScope,
} from '../../../lib/compliance-risk/broker-license-scope-api';
import {
  listInsuranceLines,
  type InsuranceLine,
} from '../../../lib/insurer/insurance-line-api';
import {
  createComplianceCalendarItem,
  listComplianceCalendarItems,
  recordComplianceSubmission,
  type ComplianceCalendarItem,
} from '../../../lib/compliance-risk/compliance-calendar-api';
import { ApiError } from '../../../lib/auth/api-client';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate, formatMoney } from '../../../lib/i18n/format';
import type { TranslationKey } from '../../../lib/i18n/translations';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';

/**
 * The six derived states, as a TOTAL map over the union.
 *
 * `satisfies Record<..., TranslationKey>` rather than a loose index, deliberately: a seventh state
 * added to the api union is then a COMPILE ERROR here instead of a cell rendering a raw enum word
 * to a reader. That is the §1.45 lesson, and it is sharper on this screen than most — the thing
 * being labelled is whether the office may lawfully trade.
 */
const STANDING_LABEL = {
  NO_TERM_ON_RECORD: 'rcStandingNoTerm',
  ACTIVE: 'rcStandingActive',
  RENEWAL_PENDING: 'rcStandingRenewalPending',
  EXPIRED: 'rcStandingExpired',
  SUSPENDED: 'rcStandingSuspended',
  CANCELLED: 'rcStandingCancelled',
} satisfies Record<BrokerLicenseSeries['standing']['status'], TranslationKey>;

/**
 * The notice stages. TOTAL over the union for the same reason as `STANDING_LABEL`: a sixth stage is
 * then a compile error rather than a blank line where a deadline warning should be.
 *
 * `NONE` has no sentence on purpose — the notice is not rendered at all while the expiry is far off,
 * and a cheerful "nothing to do" line is how a reader learns to stop looking at this panel.
 */
const NOTICE_LABEL = {
  FIRST: 'rcNoticeFirst',
  SECOND: 'rcNoticeSecond',
  CONTINUING: 'rcNoticeContinuing',
  EXPIRED: 'rcNoticeExpired',
} satisfies Record<
  Exclude<BrokerLicenseSeries['renewalNotice']['stage'], 'NONE'>,
  TranslationKey
>;

/* A WARNING, not an error. Module 0 item (d) requires the admin be told to verify a non-31-December
 * expiry and NOT be blocked, so this is visually and semantically distinct from `errorStyle`: the
 * same shape `settings/roles` uses for its duty-segregation warning. */
const warningStyle: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderInlineStartWidth: '4px',
  padding: '0.6rem 0.75rem',
  margin: '0.75rem 0',
  maxWidth: '48rem',
};
const noteStyle: CSSProperties = {
  margin: '0.35rem 0',
  maxWidth: '48rem',
  color: 'var(--ink-muted)',
};
/**
 * The same note with a little air above it — for the two lines that sit directly under the
 * standing panel rather than inside a block of their own.
 *
 * HOISTED rather than spread inline at each site: `check:screen-pass` refused this section at
 * 1059 against a budget of 1058, and it was right to. Two sites wrote `{ ...noteStyle, marginTop:
 * '0.5rem' }` by hand and a third was about to, which is three places for one decision about
 * spacing.
 */
const noteUnderPanelStyle: CSSProperties = {
  ...noteStyle,
  marginTop: '0.5rem',
};
const formStyle: CSSProperties = {
  margin: '1rem 0',
  display: 'grid',
  gap: 'var(--space-2)',
  maxWidth: '30rem',
};
/* OWNER DECISION 128's declaration block. A NAMED style rather than an inline literal:
 * `check:screen-pass` refused the inline site and its budget may only FALL, so the declaration
 * moves out instead of the number moving up. */
const renewalBlockStyle: CSSProperties = { marginTop: '0.5rem' };

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-1)',
};

export default function RegulatoryCompliancePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  // `language` picks the Arabic or English name of a catalogue line at RENDER, which is the
  // established fix: resolving it at fetch time pins the label to whichever language was active
  // when the data arrived.
  const { t, language } = useLanguage();
  const canManage = hasPermission(user, 'license.manage');
  /*
   * 🔴 OWNER DECISION 128 + 131 — a SEPARATE code, and held by no role until an office grants it.
   *
   * ⛔ NOT `canManage`. Attaching the filing proof records a fact and `license.manage` already
   * governs it; declaring that the Central Bank has sent nothing swears to one, and decision 128
   * §3 asks for «حامل الصلاحية». An office may deliberately grant one and not the other, so the
   * two controls are gated apart — `frontend-ux-directive.md`: a control a role cannot use does
   * not exist on their screen.
   */
  const canDeclareRenewal = hasPermission(user, 'license-renewal.declare');

  /*
   * ⚠️ `renewalUnderStudy` IS READ WITH `?.` EVEN THOUGH THE API ALWAYS SENDS IT.
   *
   * What crosses this boundary is DATA, not a type. The field arrived with OWNER DECISION 128, so
   * any response built before it — a cached payload, an older api during a rolling deploy, a test
   * fixture written last month — has no such key, and `undefined.state` throws rather than
   * degrading. A screen that blanks because the server is one version behind is a worse failure
   * than one that simply does not show a control it cannot justify showing.
   */

  // `license` is the CURRENT term; `terms` is the whole series. Module 0 item (c) turned the
  // licence from one row into a series, and the screen shows both: the term that decides whether
  // the office may practise, and the history a regulator asks for.
  const [license, setLicense] = useState<BrokerLicense | null>(null);
  const [terms, setTerms] = useState<BrokerLicense[]>([]);
  // THE ONE ANSWER, derived by the api on every read and enforced by `LicenseGateService`. It is
  // held separately from `license` because it is a fact about the OFFICE, not a column on a term:
  // `NO_TERM_ON_RECORD` is a real standing and there is no term to hang it on.
  const [standing, setStanding] = useState<
    BrokerLicenseSeries['standing'] | null
  >(null);
  // PIECE 3. Derived by the api on every licence read, so there is no "already shown" state here
  // either — the component renders what the last read said, which is what the date says.
  const [notice, setNotice] = useState<
    BrokerLicenseSeries['renewalNotice'] | null
  >(null);
  const [licenseLoaded, setLicenseLoaded] = useState(false);
  const [licenseLoadError, setLicenseLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<ComplianceCalendarItem[] | null>(null);
  const [itemsLoadError, setItemsLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [licenseNumber, setLicenseNumber] = useState('');
  const [scopeOfAuthorization, setScopeOfAuthorization] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  // Deliberately NOT pre-filled from the current term, unlike the fields below it: every term has
  // its OWN certificate, so carrying the previous one's file name forward would assert that the new
  // term is evidenced by the old document.
  const [certificateFileName, setCertificateFileName] = useState('');
  const [certificateStorageRef, setCertificateStorageRef] = useState('');
  const [renewalRequestedAt, setRenewalRequestedAt] = useState('');
  /** OWNER DECISION 128 conditions 2 — the filing proof and the Central Bank's reference. */
  const [renewalProofDocumentId, setRenewalProofDocumentId] = useState('');
  const [renewalReference, setRenewalReference] = useState('');
  // The regulator-decision draft. SANCTION is the default basis because it is the case an office
  // meets without choosing it; a suspension at the office own request is something it applied for.
  const [actionKind, setActionKind] = useState<
    'SUSPENSION' | 'CANCELLATION' | 'REINSTATEMENT'
  >('SUSPENSION');
  const [actionBasis, setActionBasis] = useState<'BROKER_REQUEST' | 'SANCTION'>(
    'SANCTION',
  );
  const [actionEffectiveFrom, setActionEffectiveFrom] = useState('');
  const [actionDecisionRef, setActionDecisionRef] = useState('');
  const [actionSuspendedUntil, setActionSuspendedUntil] = useState('');
  // Module 0 item (e). The scope is loaded separately from the licence because a reader may hold
  // `license.manage` and the office may still have no term — in which case the scope route 404s and
  // the licence panel is the one that explains why.
  const [scope, setScope] = useState<LicenseScope | null>(null);
  const [lines, setLines] = useState<InsuranceLine[]>([]);
  const [branchLineId, setBranchLineId] = useState('');
  const [obligationName, setObligationName] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string>>(
    {},
  );

  const loadLicense = useCallback(async () => {
    try {
      const series = await getBrokerLicense();
      setLicense(series.current);
      setTerms(series.terms);
      setStanding(series.standing);
      setNotice(series.renewalNotice);
      setLicenseLoaded(true);
      setLicenseLoadError(null);
    } catch (err) {
      setLicense(null);
      setTerms([]);
      // Cleared, never left stale: a standing from a previous successful read, shown beside a load
      // failure, would be this screen asserting that the office may trade on evidence it no longer
      // has in front of it.
      setStanding(null);
      setNotice(null);
      setLicenseLoaded(false);
      // The 404 branch that used to sit here is GONE because the route no longer returns one: an
      // office with no licence is answered as `{ current: null, terms: [] }`. A 404 could not be
      // told apart from a broken page, and this is the state that BLOCKS new business, so it has to
      // be rendered rather than reported as a load failure.
      setLicenseLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'rcRefusalAct', 'license.manage')
          : err instanceof ApiError
            ? err.message
            : t('rcLicenseLoadError'),
      );
    }
  }, [t]);

  const loadScope = useCallback(async () => {
    try {
      setScope(await getLicenseScope());
    } catch {
      // A 404 here means the office holds no term yet, which the licence panel above already says
      // in full. Repeating it as a second error would make one problem look like two.
      setScope(null);
    }
  }, []);

  const loadLines = useCallback(async () => {
    try {
      setLines(await listInsuranceLines());
    } catch {
      setLines([]);
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      setItems(await listComplianceCalendarItems());
      setItemsLoadError(null);
    } catch (err) {
      setItems(null);
      setItemsLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(
              t,
              'rcCalendarRefusalAct',
              'compliance-calendar.manage',
            )
          : err instanceof ApiError
            ? err.message
            : t('rcCalendarLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadLicense();
      // Module 0 item (e). Omitted from this effect in the first version, so the scope section
      // never rendered at all — the api, the client and the markup were right and the screen was
      // simply never asked. Caught by the Playwright tests, which is the only layer that could:
      // nothing type-checks "is this loader actually called on mount".
      await loadScope();
      await loadLines();
      await loadItems();
    })();
  }, [user, loadLicense, loadScope, loadLines, loadItems, t]);
  // A @code-reviewer MINOR: renew() replaces every field, so pre-filling
  // the form from the current record (rather than starting blank) stops an
  // officer who only means to push out expiresAt from silently wiping a
  // previously recorded scopeOfAuthorization/issuedAt they didn't touch.
  // Adjusted during render (React's own recommended pattern for "sync state
  // from a prop/fetch once it arrives"), not in a useEffect — a `licenseForm
  // Initialized` guard runs this exactly once, so it never fights with
  // whatever the officer is actively typing on a later reload.
  const [licenseFormInitialized, setLicenseFormInitialized] = useState(false);
  if (license && !licenseFormInitialized) {
    setLicenseFormInitialized(true);
    setLicenseNumber(license.licenseNumber);
    setScopeOfAuthorization(license.scopeOfAuthorization ?? '');
    setIssuedAt(license.issuedAt ? license.issuedAt.slice(0, 10) : '');
    setExpiresAt(license.expiresAt.slice(0, 10));
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await loadLicense();
      await loadScope();
      await loadItems();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('rcActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitLicense(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      const payload = {
        licenseNumber,
        scopeOfAuthorization: scopeOfAuthorization.trim() || undefined,
        issuedAt: issuedAt || undefined,
        expiresAt,
        certificateFileName: certificateFileName.trim(),
        certificateStorageRef: certificateStorageRef.trim(),
      };
      if (license) {
        await renewBrokerLicense(payload);
      } else {
        await createBrokerLicense(payload);
      }
      // Cleared so the next term cannot be recorded against the certificate just filed.
      setCertificateFileName('');
      setCertificateStorageRef('');
    });
  }

  async function submitRenewalRequest() {
    await run(async () => {
      await recordRenewalRequest({
        requestedAt: renewalRequestedAt || undefined,
        /*
         * 🔴 OWNER DECISION 128 — THE PROOF AND ITS REFERENCE TRAVEL TOGETHER OR NEITHER DOES.
         *
         * The api refuses half of them (422) and a CHECK constraint makes the half-state
         * unreachable. Sent as a pair here so the screen asks the same question the server does:
         * a date on its own opens nothing, which is the whole of «الإثبات يفتح، لا التاريخ».
         */
        proofDocumentId: renewalProofDocumentId.trim() || undefined,
        referenceNumber: renewalReference.trim() || undefined,
      });
      setRenewalRequestedAt('');
      setRenewalProofDocumentId('');
      setRenewalReference('');
    });
  }

  /**
   * 🔴 OWNER DECISION 128 — the declaration, and it is a SEPARATE ACT from filing the proof.
   *
   * Filing records a fact; this swears to one. They carry different permissions
   * (`license.manage` and `license-renewal.declare`), so an office may grant one without the
   * other — which is why the two controls are never merged into a single button.
   */
  async function submitRenewalDeclaration() {
    await run(async () => {
      await declareRenewalStanding();
    });
  }

  async function submitItem(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createComplianceCalendarItem({
        obligationName,
        ownerUserId: ownerUserId.trim(),
        dueDate,
      });
      setObligationName('');
      setOwnerUserId('');
      setDueDate('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('rcHeading')} description={t('rcIntro')} />

      <h2>{t('rcLicenseHeading')}</h2>
      {licenseLoadError ? <ErrorState title={licenseLoadError} /> : null}
      {licenseLoaded && !license ? (
        <p role="alert" style={errorStyle}>
          {t('rcNoLicenseBlocksBusiness')}
        </p>
      ) : null}
      {license ? (
        <div style={{ margin: '0.5rem 0' }}>
          <Table>
            <tbody>
              <Tr>
                <Td>{t('rcLicenseNumberLabel')}</Td>
                <Td>{license.licenseNumber}</Td>
              </Tr>
              {/*
                THE DERIVED STANDING, where a STORED FLAG used to be — and the old row was the
                three-answer defect made visible: it rendered `status` (two values, stored) and then
                appended "(currently lapsed)" from `isCurrentlyLapsed` (live-derived), so a reader
                saw two answers in one cell and had no way to know which the system acts on.

                Now it shows the six-state derivation the GATE enforces, so what the screen says and
                what the system refuses are the same value.
              */}
              <Tr>
                <Td>{t('rcStandingHeading')}</Td>
                <Td data-testid="rc-standing">
                  {/*
                    `== null`, LOOSE, so `undefined` lands here too — which is what a field the api
                    stopped sending looks like. It was `=== null`, and an absent `standing` then
                    reached `STANDING_LABEL[undefined]` and took the whole licence panel down: the
                    page rendered the CREATE form and "Loading…", indistinguishable from an office
                    that holds no licence. These types are hand-copied over HTTP and nothing checks
                    them against the view, so the degraded state has to be a state.
                  */}
                  {standing == null
                    ? '—'
                    : (STANDING_LABEL[standing.status] ?? null) === null
                      ? standing.status
                      : t(STANDING_LABEL[standing.status])}
                  {standing?.standingActDecisionRef == null ? null : (
                    <>
                      {' · '}
                      {t('rcStandingDecisionRef')}
                      {': '}
                      {standing.standingActDecisionRef}
                    </>
                  )}
                </Td>
              </Tr>
              <Tr>
                <Td>{t('rcExpires')}</Td>
                <Td>{formatDate(license.expiresAt, language)}</Td>
              </Tr>
              <Tr>
                <Td>{t('rcRenewalDueBy')}</Td>
                <Td>{formatDate(license.renewalDueBy, language)}</Td>
              </Tr>
              <Tr>
                <Td>{t('rcColRenewalFiled')}</Td>
                <Td>
                  {license.renewalRequestedAt
                    ? formatDate(license.renewalRequestedAt, language)
                    : t('rcNotFiled')}
                </Td>
              </Tr>
              {license.expectedExpiryForThreeYearTerm ? (
                <Tr>
                  <Td>{t('rcExpectedThreeYearExpiry')}</Td>
                  <Td>
                    {formatDate(
                      license.expectedExpiryForThreeYearTerm,
                      language,
                    )}
                  </Td>
                </Tr>
              ) : null}
            </tbody>
          </Table>

          {/* Art. 10/b. A warning to VERIFY, never a refusal — the date is entered as printed on
              the certificate and the certificate is the authority. */}
          {!license.expiryIsEndOfCalendarYear ? (
            <p
              style={warningStyle}
              role="status"
              data-expiry-not-end-of-year=""
            >
              {t('rcExpiryNotEndOfYearWarning')}
            </p>
          ) : null}

          {/* Art. 10/b's PART-YEAR rule. `=== false` and not `!matches`: null means no issue date
              on record, which is a missing field and not a discrepancy, and would otherwise warn
              every office that never recorded one. Also a warning only — same reason as above. */}
          {license.expiryMatchesThreeYearTerm === false ? (
            <p
              style={warningStyle}
              role="status"
              data-expiry-not-three-year-term=""
            >
              {t('rcExpiryNotThreeYearTermWarning')}
            </p>
          ) : null}

          {/*
            Art. 11. Without this the screen would show an expiry in the past and a licence the
            system is content with, and explain neither.

            🔴 OWNER DECISION 159 RULING 1-ب — AND IT IS THE DECLARATION THAT PUTS IT THERE, NOT
            THE DATE.

            `validPendingRenewalDecision` is the DATE-ONLY rule (`isValidPendingRenewalDecision`
            — past the printed expiry with a timely filing), which is precisely the rule decision
            128 replaced. On its own it rendered «ما زال ساريًا» for an office the system was
            REFUSING: filed on time with no proof, or with nobody having declared, and the
            sentence said the licence was treated as current while the gate blocked all six
            issuance acts.

            ⛔ THE api FLAG IS NOT CHANGED, and that is measured rather than conceded. It has
            exactly ONE product reader — this line — and it is asserted by
            `broker-license.config.spec.ts`, `legal-figures.config.spec.ts` and
            `regulatory-compliance.e2e-spec.ts` as the date-only fact it names;
            `license-standing.config.ts`'s own header keeps it «preserved one level down» so an
            officer can still see WHY the licence is past its date. Redefining it would move a
            fact three specs name, to fix a condition that belongs to this render.

            ⟶ So the SCREEN asks the four-condition state instead: the sentence stands exactly
            when the state is `UNDER_STUDY`, which is after the declaration and never before.
            The English half's words are not ruled and do not change; its condition moves with
            the Arabic, because a condition is not a word.
          */}
          {license.validPendingRenewalDecision &&
          standing?.renewalUnderStudy?.state === 'UNDER_STUDY' ? (
            <p
              style={warningStyle}
              role="status"
              data-valid-pending-renewal-decision=""
            >
              {t('rcValidPendingRenewalDecision')}
            </p>
          ) : null}

          {/* Filed, but late — so the extension above will NOT apply when the term runs out. Said
              while there is still time to do something about it. */}
          {license.renewalRequestedAt && !license.renewalFiledOnTime ? (
            <p style={warningStyle} role="status" data-renewal-filed-late="">
              {t('rcRenewalFiledLate')}
            </p>
          ) : null}
          {/*
            WHAT THE BLOCK ACTUALLY IS, said once and in full.

            `mayPractise` is read, never the label — the api header is explicit that the two are not
            interchangeable, and the gate reads the same field. So what a reader sees here and what
            the system refuses are one value.

            It NAMES the six acts refused and the five that continue, because an office told only
            that it is blocked has no way to know whether it may still collect a premium or handle a
            claim — and an over-wide reading of a block is a worse defect than the block missing.
          */}
          {standing !== null && !standing.mayPractise ? (
            <p
              style={warningStyle}
              role="status"
              data-standing-may-not-practise=""
            >
              {t('rcStandingMayNotPractise')}
            </p>
          ) : null}
          {/*
            Art. 14/c, and the distinction is the whole reason this flag exists on the wire: a
            cancellation the CBJ DECIDED and one the law reached on its own are different facts, and
            only the second is something an office can be surprised by.
          */}
          {standing?.deemedCancelledUnderArticle14C ? (
            <p style={warningStyle} role="status" data-deemed-cancelled="">
              {t('rcStandingDeemedCancelled')}
            </p>
          ) : null}
          {/*
            🔴 OWNER DECISION 159 RULING 3 — WHO DECLARED, AND WHEN, UNDER THE STANDING.

            «موافقة على الجملة الشغّالة» — her ruling approves the sentence already shipping on
            the DPO assignment card, and `rcRenewalDeclaredBy` carries it byte for byte in its
            own key (decision 157 ruling 2).

            BOTH FACTS COME FROM THE STATE, which is the only place they exist: the name is
            `actorNameShown`, STORED on the day of the declaration, so a renamed account or a
            person who has left does not change who swore to it. The date goes through
            `formatDate` (decision 156 ruling 1) — ⛔ never a slice of the ISO string, which
            prints the UTC day and reads as yesterday in Amman's small hours.

            The narrowing to `UNDER_STUDY` is what makes the two fields total rather than
            nullable: there is no other state with an answer.
          */}
          {standing?.renewalUnderStudy?.state === 'UNDER_STUDY' ? (
            <p
              style={noteUnderPanelStyle}
              role="status"
              data-renewal-declared-by=""
            >
              {t('rcRenewalDeclaredBy', {
                who: standing.renewalUnderStudy.declaredByName,
                when: formatDate(standing.renewalUnderStudy.declaredAt, language),
              })}
            </p>
          ) : null}
          <p style={noteUnderPanelStyle} role="status">
            {t('rcStandingDerived')}
          </p>

          {/*
            THE OFFICE RECORDS THE LETTER IT RECEIVED — in place of a one-click button that marked
            the licence lapsed and stored nothing about why.

            There is no regulator in this system: the CBJ acts outside the product, and three
            organization types exist. This is the office own record, which is why it sits on the
            office own screen behind the office own `license.manage`.
          */}
          {canManage ? (
            <div
              style={{ marginTop: '0.75rem' }}
              data-regulatory-action-form=""
            >
              <h3 style={{ margin: '0 0 0.25rem' }}>{t('rcActionsHeading')}</h3>
              <p style={noteStyle}>{t('rcActionReplacesMarker')}</p>
              <label style={labelStyle}>
                {t('rcActionKind')}
                <select
                  value={actionKind}
                  onChange={(e) =>
                    setActionKind(e.target.value as typeof actionKind)
                  }
                >
                  <option value="SUSPENSION">
                    {t('rcActionKindSuspension')}
                  </option>
                  <option value="CANCELLATION">
                    {t('rcActionKindCancellation')}
                  </option>
                  <option value="REINSTATEMENT">
                    {t('rcActionKindReinstatement')}
                  </option>
                </select>
              </label>
              <label style={labelStyle}>
                {t('rcActionBasis')}
                <select
                  value={actionBasis}
                  onChange={(e) =>
                    setActionBasis(e.target.value as typeof actionBasis)
                  }
                >
                  <option value="SANCTION">{t('rcActionBasisSanction')}</option>
                  <option value="BROKER_REQUEST">
                    {t('rcActionBasisBrokerRequest')}
                  </option>
                </select>
              </label>
              <label style={labelStyle}>
                {t('rcActionEffectiveFrom')}
                <input
                  type="date"
                  value={actionEffectiveFrom}
                  onChange={(e) => setActionEffectiveFrom(e.target.value)}
                />
              </label>
              <label style={labelStyle}>
                {t('rcActionDecisionRef')}
                <input
                  value={actionDecisionRef}
                  onChange={(e) => setActionDecisionRef(e.target.value)}
                />
              </label>
              {/* Only a SUSPENSION may carry an end date — the database refuses it on any other
                  kind by CHECK, so offering the field there would be offering a 400. */}
              {actionKind === 'SUSPENSION' ? (
                <label style={labelStyle}>
                  {t('rcActionSuspendedUntil')}
                  <input
                    type="date"
                    value={actionSuspendedUntil}
                    onChange={(e) => setActionSuspendedUntil(e.target.value)}
                  />
                </label>
              ) : null}
              <button
                type="button"
                /* The reference is NOT NULL in the database and required by the DTO, so the control
                   refuses rather than sending a request it knows will 400. */
                disabled={
                  busy ||
                  actionEffectiveFrom === '' ||
                  actionDecisionRef.trim() === ''
                }
                onClick={() =>
                  void run(async () => {
                    await recordRegulatoryAction({
                      kind: actionKind,
                      basis: actionBasis,
                      effectiveFrom: actionEffectiveFrom,
                      decisionRef: actionDecisionRef.trim(),
                      suspendedUntil:
                        actionKind === 'SUSPENSION' && actionSuspendedUntil
                          ? actionSuspendedUntil
                          : undefined,
                    });
                    setActionDecisionRef('');
                    setActionSuspendedUntil('');
                  })
                }
              >
                {t('rcRecordActionButton')}
              </button>
            </div>
          ) : null}
          {/* Write-once: art. 11 measures lateness from the filing date, so the control disappears
              once one is recorded rather than offering an edit the API would refuse. */}
          {canManage && !license.renewalRequestedAt ? (
            <div style={{ marginTop: '0.5rem' }} data-renewal-filing="">
              <label style={labelStyle}>
                {t('rcRenewalRequestedAtLabel')}
                <input
                  type="date"
                  aria-label={t('rcRenewalRequestedAtLabel')}
                  value={renewalRequestedAt}
                  onChange={(e) => setRenewalRequestedAt(e.target.value)}
                />
              </label>
              {/*
                🔴 OWNER DECISION 128 — THE PROOF OPENS ISSUANCE, NOT THE DATE.
                «الإثبات يفتح، لا التاريخ.» Before this decision a date typed into the field
                above opened all six issuance acts on its own. These two fields are condition 2,
                and the api refuses one without the other.
              */}
              {/*
                🔴 A PICKER, NOT A TYPED uuid — `check:typed-identifiers` refused the text input
                and was right: «nobody knows a uuid», and the proof is a document somebody has
                just scanned and named.

                ⚠️ GATED ON `document.read`, which is NOT implied by `license.manage`. The picker
                searches the office's whole document register, so offering it to somebody who may
                not read that register would be a way around `document.read` — the same reasoning
                `/audit-trail` records at its own document chooser. A licence manager without it
                keeps a working screen: the filing still records with its date, and the proof is
                attached by somebody who may see the register.
              */}
              {hasPermission(user, 'document.read') ? (
                <div data-renewal-proof="">
                  <EntitySearch
                    kind="document"
                    value={renewalProofDocumentId}
                    onChange={setRenewalProofDocumentId}
                    label={t('rcRenewalProofLabel')}
                  />
                </div>
              ) : null}
              <label style={labelStyle}>
                {t('rcRenewalReferenceLabel')}
                <input
                  type="text"
                  aria-label={t('rcRenewalReferenceLabel')}
                  data-renewal-reference=""
                  value={renewalReference}
                  onChange={(e) => setRenewalReference(e.target.value)}
                />
              </label>
              {/* A stable hook, added with decision 153 §٢ row ٣: this screen now renders two
                  controls whose labels both open «تسجيل», and a test that located either by
                  text would follow whichever the DOM happened to give it first. */}
              <button
                type="button"
                data-renewal-file=""
                disabled={busy}
                onClick={() => void submitRenewalRequest()}
              >
                {t('rcRecordRenewalButton')}
              </button>
            </div>
          ) : null}
          {/*
            🔴 OWNER DECISION 128 — THE STANDING DECLARATION, AND ITS OWN PERMISSION.

            `frontend-ux-directive.md`: a control a role cannot use does not exist on their
            screen. The route carries `license-renewal.declare`, which is held by NO role until
            an office grants it (decision 131) — so this is the one control on this screen that
            a licence manager may not see, and that is the decision working rather than a bug.

            ⛔ IT SHOWS ONLY WHERE IT CAN ACT: past the printed expiry, with the filing and the
            proof already in, and no declaration yet. Standing it up earlier would invite a
            person to swear to something before there is anything to swear about, and the row is
            append-only — there is no undo.
          */}
          {canDeclareRenewal &&
          standing?.renewalUnderStudy?.state === 'AWAITING_DECLARATION' ? (
            <div style={renewalBlockStyle} data-renewal-declaration="">
              {/*
                ⛔ THE SENTENCE IS SHOWN, AND THE BUTTON IS NOT THE SENTENCE.
                A control whose label is a 70-character oath is unreadable, and worse, it would
                make the oath look like the name of a button rather than something the person is
                stating. She is SHOWN what she is declaring; the control says what pressing it
                does. The api stores the sentence verbatim either way — it never takes a caller's
                wording — so the record testifies to the text above and not to the label.
              */}
              <p style={noteStyle} data-renewal-declaration-sentence="">
                {t('rcRenewalDeclarationSentence')}
              </p>
              {/* 🔴 OWNER DECISION 153 §٢ ROW ٣ — «تسجيل الإقرار», its OWN key.
                  This control used to carry `rcRecordRenewalButton`, the FILING control's
                  label, so the screen offered two different acts under one name. ⛔ The filing
                  control above keeps that label; one key cannot name both. */}
              <button
                type="button"
                data-renewal-declare=""
                disabled={busy}
                onClick={() => void submitRenewalDeclaration()}
              >
                {t('rcRecordDeclarationButton')}
              </button>
            </div>
          ) : null}
          {/*
            OWNER DECISION 136(ب) — the sentence for an office that may not issue because nobody
            has declared yet.

            🔴 WITHHELD FROM THE ONE PERSON WHO CAN END IT, and the correction is the owner's
            (§T2 of her second demo walk). It used to render for EVERY reader, on the reasoning
            that the employee who met this refusal on a policy needs the same words here — true,
            and it is still shown to them. What it must not do is stand BESIDE THE BUTTON: this
            sentence ends «راجع مسؤول النظام في مكتبك», and printing it to the holder of
            `license-renewal.declare` sends that person to ask themselves for the act they are
            looking at the control for.

            ⛔ NO WORD CHANGES. The sentence is hers, byte for byte; only its condition moved.
          */}
          {!canDeclareRenewal &&
          standing?.renewalUnderStudy?.state === 'AWAITING_DECLARATION' ? (
            <p
              style={warningStyle}
              role="status"
              data-renewal-awaiting-declaration=""
            >
              {t('rcRenewalAwaitingDeclaration')}
            </p>
          ) : null}
          {terms.length > 1 ? (
            <div style={{ marginTop: '1rem' }}>
              <h3>{t('rcTermsHeading')}</h3>
              {/* A stable hook: this screen renders three tables (the current term, this series,
                  and the compliance calendar), so a positional locator in a test would silently
                  follow whichever happens to be last. */}
              <Table data-testid="licence-terms">
                <thead>
                  <tr>
                    <Th>{t('rcLicenseNumberLabel')}</Th>
                    <Th>{t('rcIssuedAtLabel')}</Th>
                    <Th>{t('rcExpiresAtLabel')}</Th>
                    <Th>{t('rcColStatus')}</Th>
                    <Th>{t('rcColRenewalFiled')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map((term) => (
                    <Tr key={term.id}>
                      <Td>
                        {term.licenseNumber}
                        {term.id === license.id
                          ? ` (${t('rcCurrentTerm')})`
                          : ''}
                      </Td>
                      <Td>
                        {term.issuedAt
                          ? formatDate(term.issuedAt, language)
                          : '—'}
                      </Td>
                      <Td>{formatDate(term.expiresAt, language)}</Td>
                      {/*
                        A TERM HAS NO STATUS OF ITS OWN ANY MORE. The column it rendered is dropped,
                        and nothing is lost: `pickCurrentTerm` decides which term governs by LATEST
                        EXPIRY, so a superseded term needs no flag to stop governing — and the
                        office's STANDING is one answer about the office, not a column on each row.
                        What a reader needs per term is the period, which the two cells beside this
                        one already give.
                      */}
                      <Td>
                        {term.renewalRequestedAt
                          ? formatDate(term.renewalRequestedAt, language)
                          : t('rcNotFiled')}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}

      {scope ? (
        <section>
          <h2>{t('rcScopeHeading')}</h2>

          {/* Art. 3/a. Said BEFORE the add form rather than only in the refusal, so an officer
              learns the limit before hitting it. */}
          {scope.brokerKind === 'NATURAL_PERSON' ? (
            <>
              <p style={warningStyle} role="status" data-sole-establishment="">
                {t('rcScopeSoleEstablishmentNote')}
              </p>
              {/*
               * THE REFUSAL DECLARES ITS OWN BASIS (owner's instruction, 2026-10-16).
               *
               * Art. 3/a's one-type refusal is keyed on `brokerKind === 'NATURAL_PERSON'` and says
               * nothing about `brokerageKind`, so it fires on a reinsurance broker exactly as it does
               * on a direct one — while register entry 20 records that whether Instructions No. 9 of
               * 2026 govern a reinsurance broker at all is UNRESOLVED, and that the column's own
               * comment once claimed those guards "must not fire" for one. They do.
               *
               * NOTHING IS DECIDED HERE AND NO GUARD CHANGED. Entry 20 stays open. What changes is that
               * a refusal which may rest on an article that does not govern this office stops being
               * silent about its own basis — the reader is told the rule is applied to every brokerage
               * office because this product holds no separate text for reinsurance brokerage.
               *
               * IT IS STATED FOR EVERY NATURAL-PERSON OFFICE RATHER THAN ONLY A REINSURANCE ONE, and
               * that is deliberate twice over: the sentence is TRUE of every brokerage office, which is
               * precisely the thing being declared; and conditioning it on `brokerageKind` would give
               * that column its first reader, when entry 20's finding is that it is stored and read by
               * nothing and its meaning is unsettled. A note whose visibility depends on an unresolved
               * field is a second unresolved question.
               *
               * `role="status"` and not `alert`: this is the basis of a refusal, not a second refusal.
               */}
              <p role="status" data-one-type-basis="">
                {t('rcScopeOneTypeBasisNote')}
              </p>
            </>
          ) : null}

          <p>
            <strong>{t('rcScopeTypes')}:</strong>{' '}
            <span data-licence-types="">
              {scope.types.length > 0
                ? scope.types
                    .map(
                      (type) =>
                        `${t(ENUM_LABEL.InsuranceLineCategory[type])} (${
                          scope.branchCountByType[type] ?? 0
                        })`,
                    )
                    .join(' · ')
                : '—'}
            </span>
          </p>

          <h3>{t('rcScopeBranches')}</h3>
          {scope.branches.length === 0 ? (
            <p style={{ opacity: 0.75 }}>{t('rcScopeNoBranches')}</p>
          ) : (
            <table
              data-licence-branches=""
              style={{ borderCollapse: 'collapse' }}
            >
              <thead>
                <tr>
                  <Th>{t('rcScopeColBranch')}</Th>
                  <Th>{t('rcScopeColType')}</Th>
                  {canManage ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {scope.branches.map((branch) => (
                  <Tr key={branch.id}>
                    <Td>{language === 'AR' ? branch.nameAr : branch.nameEn}</Td>
                    <Td>
                      {t(ENUM_LABEL.InsuranceLineCategory[branch.category])}
                    </Td>
                    {canManage ? (
                      <Td>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => removeLicenseScopeBranch(branch.id))
                          }
                        >
                          {t('rcScopeRemove')}
                        </button>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </table>
          )}

          {canManage ? (
            <div style={{ marginTop: '0.5rem' }}>
              <label style={labelStyle}>
                {t('rcScopeBranchLabel')}
                {/* A SELECT over the managed catalogue, not a free-text field: a branch is a
                    catalogue row, and typing one would invite a name the catalogue does not hold.
                    `isStandard` decides WHICH id the api is given — the two catalogues are
                    addressed by different fields and exactly one may be named. */}
                <select
                  aria-label={t('rcScopeBranchLabel')}
                  value={branchLineId}
                  onChange={(e) => setBranchLineId(e.target.value)}
                >
                  {/* OWNER DECISION 153 §٢ row ٢٠-ب. */}
                  <option value="">{t('rcLineChoosePlaceholder')}</option>
                  {lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {(language === 'AR' ? line.nameAr : line.nameEn) +
                        ' · ' +
                        t(ENUM_LABEL.InsuranceLineCategory[line.category])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !branchLineId}
                onClick={() =>
                  void run(async () => {
                    const line = lines.find((l) => l.id === branchLineId);
                    if (!line) return;
                    await addLicenseScopeBranch(
                      line.isStandard
                        ? { insuranceLineId: line.id }
                        : { officeInsuranceLineId: line.id },
                    );
                    setBranchLineId('');
                  })
                }
              >
                {t('rcScopeAddBranch')}
              </button>
            </div>
          ) : null}

          <h3>{t('rcStaffingHeading')}</h3>
          {/* Item (f). Stated while the form is still empty: the refusal only fires on the branch
              that would add a SECOND type, so a screen that waited for it would teach the rule by
              failure. Both numbers come from the server, computed by the same function the refusal
              uses, so the two cannot disagree. */}
          <p data-staffing="">
            {t('rcStaffingRequired')} {scope.staffing.requiredApprovedStaff} ·{' '}
            {t('rcStaffingCurrent')} {scope.staffing.currentApprovedStaff}
          </p>
          {scope.staffing.meetsRequirement ? (
            <p style={{ opacity: 0.75 }} data-staffing-ok="">
              {t('rcStaffingMetNote')}
            </p>
          ) : (
            <p style={warningStyle} role="status" data-staffing-short="">
              {t('rcStaffingShortNote')}
            </p>
          )}

          <h3>{t('rcCapitalHeading')}</h3>
          {/* THE COUNTING UNIT IS NOT SETTLED, AND THE SCREEN SAYS SO RATHER THAN IMPLYING IT IS.
              Art. 4/a's slabs count branches within a type, so the unit decides the money figure —
              and this figure counts OUR 32-line catalogue, which an unattributed reply from the
              Central Bank suggests is a commercial product list rather than the Bank's own shorter
              regulatory classification. Nothing is built on that reply; what it does is stop this
              screen stating a settled answer. See `requiredCapitalForScope`. */}
          <p role="status" data-testid="capital-counting-unit-unverified">
            {t('rcCapitalCountingUnitUnverified')}
          </p>
          <Table>
            <tbody>
              <Tr>
                <Td>{t('rcCapitalRequired')}</Td>
                <Td data-required-capital="">
                  {formatMoney(scope.capital.requiredCapital, language)}
                </Td>
              </Tr>
              <Tr>
                <Td>{t('rcCapitalPaidUp')}</Td>
                <Td>
                  {scope.capital.paidUpCapital === null
                    ? '—'
                    : formatMoney(scope.capital.paidUpCapital, language)}
                </Td>
              </Tr>
            </tbody>
          </Table>

          {/* Three STATES, not two. "Nothing recorded" is a missing fact about the office;
              "recorded and short" is a finding about its capital. Conflating them would tell an
              office it is undercapitalised when nobody has typed the number. Neither blocks. */}
          {scope.capital.capitalIsUnrecorded ? (
            <p style={warningStyle} role="status" data-capital-unrecorded="">
              {t('rcCapitalUnrecordedWarning')}
            </p>
          ) : scope.capital.meetsRequirement ? (
            <p style={{ opacity: 0.75 }} data-capital-ok="">
              {t('rcCapitalMeets')}
            </p>
          ) : (
            <p style={warningStyle} role="status" data-capital-shortfall="">
              {t('rcCapitalShortfallWarning')}
            </p>
          )}
        </section>
      ) : null}

      {canManage ? (
        <form onSubmit={submitLicense} style={formStyle}>
          <label style={labelStyle}>
            {t('rcLicenseNumber')}
            <input
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('rcCertificateFileName')}
            <input
              value={certificateFileName}
              onChange={(e) => setCertificateFileName(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('rcCertificateStorageRef')}
            <input
              value={certificateStorageRef}
              onChange={(e) => setCertificateStorageRef(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('rcScopeOfAuth')}
            <input
              value={scopeOfAuthorization}
              onChange={(e) => setScopeOfAuthorization(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            {t('rcIssuedAt')}
            <input
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            {t('rcExpiresAt')}
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy
              ? t('rcSavingButton')
              : license
                ? t('rcRenewButton')
                : t('rcCreateButton')}
          </button>
        </form>
      ) : null}

      <h2 style={{ marginTop: '2rem' }}>{t('rcCalendarHeading')}</h2>

      {/*
        THE RENEWAL NOTICE, AT THE TOP OF THE CALENDAR — which is its stated home, because the
        licence renewal IS a regulatory obligation with a date, and an office reading its
        obligations should not have to scroll up to a different panel to find the one with a
        statutory deadline on it.

        It is rendered only from FIRST onwards. `NONE` prints nothing at all: a panel that says
        "nothing due" every day is a panel a reader stops looking at, and this one has to be
        believed on the day it changes.

        WHO SEES IT is the permission, never a role name (و.١١). `license.manage` gates the read
        that carries it and `compliance-calendar.manage` gates this section — MEASURED to be held by
        the same seeded set, so no routing table and no new code.
      */}
      {notice != null &&
      notice.stage !== 'NONE' &&
      notice.stage in NOTICE_LABEL ? (
        <div style={warningStyle} role="status" data-renewal-notice="">
          <strong>{t('rcNoticeHeading')}</strong>
          <p style={{ margin: '0.35rem 0' }}>{t(NOTICE_LABEL[notice.stage])}</p>
          <table>
            <tbody>
              {notice.daysToExpiry === null ? null : (
                <Tr>
                  <Td>
                    {/* Two labels, because "3 days remaining" and "3 days since it expired" are
                        different facts and one of them is a block that is already in force. */}
                    {notice.daysToExpiry < 0
                      ? t('rcNoticeDaysSince')
                      : t('rcNoticeDays')}
                  </Td>
                  <Td>{Math.abs(notice.daysToExpiry)}</Td>
                </Tr>
              )}
              <Tr>
                <Td>{t('rcExpires')}</Td>
                <Td>
                  {notice.expiresAt
                    ? formatDate(notice.expiresAt, language)
                    : '—'}
                </Td>
              </Tr>
              <Tr>
                <Td>{t('rcNoticeApplicationDueBy')}</Td>
                <Td>
                  {notice.applicationDueBy
                    ? formatDate(notice.applicationDueBy, language)
                    : '—'}
                </Td>
              </Tr>
            </tbody>
          </table>
          {/*
            A FILING IS NOT A DECISION — said in full, because an office that applied on time and
            heard nothing is the one most likely to read a quiet screen as "handled".

            🔴 OWNER DECISION 160 RULING 1 — AND IT IS NOT SAID ONCE THE BLOCK IS LIFTED.

            The final walk found `rcNoticeFiled` still on the screen after the declaration, in
            `UNDER_STUDY`, saying «وهذا لا يَرفعُ المنعَ» — true of a filing and false of this
            office, whose block the declaration HAD just lifted. That is decision 159's own open
            question, answered by measurement rather than reworded.

            ⛔ A CONDITION, NOT A REWORDING. Not one word of either sentence changes, and
            `rcNoticeNotFiled` does NOT stand in its place: the filing IS recorded, so saying
            there is none would be a second false sentence. The paragraph simply is not there,
            and the «أقرّ به …» line above says what happened instead.

            ⛔ The not-filed branch is untouched in every state — an office that never filed must
            still be told so, however the rest of the panel reads.
          */}
          {notice.renewalFiled &&
          standing?.renewalUnderStudy?.state === 'UNDER_STUDY' ? null : (
            <p style={{ margin: '0.35rem 0' }} data-renewal-notice-filing="">
              {notice.renewalFiled ? t('rcNoticeFiled') : t('rcNoticeNotFiled')}
            </p>
          )}
          {/* Where each figure comes from. 45 is art. 11; 30 is ours and says so, because a number
              shown beside a citation it does not have is this product asserting a provision. */}
          <p style={noteStyle}>{t('rcNoticeNoSource')}</p>
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={submitItem} style={formStyle}>
          <label style={labelStyle}>
            {t('rcObligationLabel')}
            <input
              aria-label={t('rcObligationLabel')}
              value={obligationName}
              onChange={(e) => setObligationName(e.target.value)}
              required
            />
          </label>
          <EntitySearch
            kind="user"
            value={ownerUserId}
            onChange={setOwnerUserId}
            label={t('rcOwnerUserId')}
            required
          />
          <label style={labelStyle}>
            {t('rcDueDate')}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('rcSavingButton') : t('rcAddObligationButton')}
          </button>
        </form>
      ) : null}

      {actionError ? <ErrorState title={actionError} /> : null}
      {itemsLoadError ? <ErrorState title={itemsLoadError} /> : null}

      {items ? (
        items.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('rcNoCalendarItems')}
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('rcObligationLabel')}</Th>
                <Th>{t('rcColDue')}</Th>
                <Th>{t('rcColStatus')}</Th>
                <Th>{t('rcColEvidence')}</Th>
                <Th>{t('rcColAction')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <Tr key={it.id}>
                  <Td>{it.obligationName}</Td>
                  <Td>
                    {formatDate(it.dueDate, language)}
                    {it.isOverdue ? ` ${t('statusOverdue')}` : ''}
                  </Td>
                  <Td>
                    {/* Owner decision 55 — «لم يُقدَّم», NOT «قيد الانتظار»: the English said `pending`,
                        which reads as BEING PROCESSED, while `isSubmitted` false means nothing has
                        been filed at all. Different facts, and the second is the one a regulator
                        asks about. */}
                    {it.isSubmitted
                      ? t('statusSubmitted')
                      : t('statusNotSubmitted')}
                  </Td>
                  <Td>{it.evidenceOfSubmissionRef ?? '—'}</Td>
                  <Td>
                    {canManage && !it.isSubmitted ? (
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <input
                          aria-label={t('rcEvidenceRefAria', {
                            name: it.obligationName,
                          })}
                          value={evidenceDrafts[it.id] ?? ''}
                          onChange={(e) =>
                            setEvidenceDrafts((prev) => ({
                              ...prev,
                              [it.id]: e.target.value,
                            }))
                          }
                          placeholder={t('rcEvidenceRefLabel')}
                          style={{ width: '9rem' }}
                        />
                        <button
                          type="button"
                          disabled={busy || !evidenceDrafts[it.id]?.trim()}
                          onClick={() =>
                            void run(() =>
                              recordComplianceSubmission(it.id, {
                                evidenceOfSubmissionRef:
                                  evidenceDrafts[it.id]!.trim(),
                              }),
                            )
                          }
                        >
                          {t('rcRecordSubmissionButton')}
                        </button>
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )
      ) : itemsLoadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <SkeletonList rows={4} label={t('rcLoading')} />
      )}
    </main>
  );
}
