'use client';

import {
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
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
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
const formStyle: CSSProperties = {
  margin: '1rem 0',
  display: 'grid',
  gap: '0.4rem',
  maxWidth: '30rem',
};
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

export default function RegulatoryCompliancePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  // `language` picks the Arabic or English name of a catalogue line at RENDER, which is the
  // established fix: resolving it at fetch time pins the label to whichever language was active
  // when the data arrived.
  const { t, language } = useLanguage();
  const canManage = hasPermission(user, 'license.manage');

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
      });
      setRenewalRequestedAt('');
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
    <main style={pageStyle}>
      <h1>{t('rcHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{t('rcIntro')}</p>

      <h2>{t('rcLicenseHeading')}</h2>
      {licenseLoadError ? (
        <p role="alert" style={errorStyle}>
          {licenseLoadError}
        </p>
      ) : null}
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
                <Td>{license.expiresAt.slice(0, 10)}</Td>
              </Tr>
              <Tr>
                <Td>{t('rcRenewalDueBy')}</Td>
                <Td>{license.renewalDueBy.slice(0, 10)}</Td>
              </Tr>
              <Tr>
                <Td>{t('rcColRenewalFiled')}</Td>
                <Td>
                  {license.renewalRequestedAt
                    ? license.renewalRequestedAt.slice(0, 10)
                    : t('rcNotFiled')}
                </Td>
              </Tr>
              {license.expectedExpiryForThreeYearTerm ? (
                <Tr>
                  <Td>{t('rcExpectedThreeYearExpiry')}</Td>
                  <Td>
                    {license.expectedExpiryForThreeYearTerm.slice(0, 10)}
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

          {/* Art. 11. Without this the screen would show an expiry in the past and a licence the
              system is content with, and explain neither. */}
          {license.validPendingRenewalDecision ? (
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
          <p style={{ ...noteStyle, marginTop: '0.5rem' }} role="status">
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
            <div style={{ marginTop: '0.75rem' }} data-regulatory-action-form="">
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
            <div style={{ marginTop: '0.5rem' }}>
              <label style={labelStyle}>
                {t('rcColRenewalFiled')}
                <input
                  type="date"
                  aria-label={t('rcColRenewalFiled')}
                  value={renewalRequestedAt}
                  onChange={(e) => setRenewalRequestedAt(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitRenewalRequest()}
              >
                {t('rcRecordRenewalButton')}
              </button>
            </div>
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
                        {term.issuedAt ? term.issuedAt.slice(0, 10) : '—'}
                      </Td>
                      <Td>{term.expiresAt.slice(0, 10)}</Td>
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
                          ? term.renewalRequestedAt.slice(0, 10)
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
                    <Td>
                      {language === 'AR' ? branch.nameAr : branch.nameEn}
                    </Td>
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
                  <option value="">—</option>
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
                  {scope.capital.requiredCapital}
                </Td>
              </Tr>
              <Tr>
                <Td>{t('rcCapitalPaidUp')}</Td>
                <Td>{scope.capital.paidUpCapital ?? '—'}</Td>
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
              aria-label={t('rcLicenseNumberLabel')}
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('rcCertificateFileName')}
            <input
              aria-label={t('rcCertificateFileNameLabel')}
              value={certificateFileName}
              onChange={(e) => setCertificateFileName(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('rcCertificateStorageRef')}
            <input
              aria-label={t('rcCertificateStorageRefLabel')}
              value={certificateStorageRef}
              onChange={(e) => setCertificateStorageRef(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('rcScopeOfAuth')}
            <input
              aria-label={t('rcScopeLabel')}
              value={scopeOfAuthorization}
              onChange={(e) => setScopeOfAuthorization(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            {t('rcIssuedAt')}
            <input
              aria-label={t('rcIssuedAtLabel')}
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            {t('rcExpiresAt')}
            <input
              aria-label={t('rcExpiresAtLabel')}
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
      {notice != null && notice.stage !== 'NONE' && notice.stage in NOTICE_LABEL ? (
        <div style={warningStyle} role="status" data-renewal-notice="">
          <strong>{t('rcNoticeHeading')}</strong>
          <p style={{ margin: '0.35rem 0' }}>
            {t(NOTICE_LABEL[notice.stage])}
          </p>
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
                  {notice.expiresAt ? notice.expiresAt.slice(0, 10) : '—'}
                </Td>
              </Tr>
              <Tr>
                <Td>{t('rcNoticeApplicationDueBy')}</Td>
                <Td>
                  {notice.applicationDueBy
                    ? notice.applicationDueBy.slice(0, 10)
                    : '—'}
                </Td>
              </Tr>
            </tbody>
          </table>
          {/* A FILING IS NOT A DECISION — said in full, because an office that applied on time and
              heard nothing is the one most likely to read a quiet screen as "handled". */}
          <p style={{ margin: '0.35rem 0' }} data-renewal-notice-filing="">
            {notice.renewalFiled ? t('rcNoticeFiled') : t('rcNoticeNotFiled')}
          </p>
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
              aria-label={t('rcDueDateLabel')}
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

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {itemsLoadError ? (
        <p role="alert" style={errorStyle}>
          {itemsLoadError}
        </p>
      ) : null}

      {items ? (
        items.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('rcNoCalendarItems')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
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
                      {it.dueDate.slice(0, 10)}
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
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
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
          </div>
        )
      ) : itemsLoadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('rcLoading')}</p>
      )}
    </main>
  );
}
