'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createBrokerLicense,
  getBrokerLicense,
  markBrokerLicenseLapsed,
  recordRenewalRequest,
  renewBrokerLicense,
  type BrokerLicense,
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
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};
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
      setLicenseLoaded(true);
      setLicenseLoadError(null);
    } catch (err) {
      setLicense(null);
      setTerms([]);
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
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={cell}>{t('rcLicenseNumberLabel')}</td>
                <td style={cell}>{license.licenseNumber}</td>
              </tr>
              <tr>
                <td style={cell}>{t('rcColStatus')}</td>
                <td style={cell}>
                  {t(ENUM_LABEL.BrokerLicenseStatus[license.status])}
                  {license.isCurrentlyLapsed ? ' (currently lapsed)' : ''}
                </td>
              </tr>
              <tr>
                <td style={cell}>{t('rcExpires')}</td>
                <td style={cell}>{license.expiresAt.slice(0, 10)}</td>
              </tr>
              <tr>
                <td style={cell}>{t('rcRenewalDueBy')}</td>
                <td style={cell}>{license.renewalDueBy.slice(0, 10)}</td>
              </tr>
              <tr>
                <td style={cell}>{t('rcColRenewalFiled')}</td>
                <td style={cell}>
                  {license.renewalRequestedAt
                    ? license.renewalRequestedAt.slice(0, 10)
                    : t('rcNotFiled')}
                </td>
              </tr>
              {license.expectedExpiryForThreeYearTerm ? (
                <tr>
                  <td style={cell}>{t('rcExpectedThreeYearExpiry')}</td>
                  <td style={cell}>
                    {license.expectedExpiryForThreeYearTerm.slice(0, 10)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

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
          {canManage && !license.isCurrentlyLapsed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => markBrokerLicenseLapsed())}
              style={{ marginTop: '0.5rem' }}
            >
              {t('rcMarkLapsedButton')}
            </button>
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
              <table
                data-testid="licence-terms"
                style={{ borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr>
                    <th style={cell}>{t('rcLicenseNumberLabel')}</th>
                    <th style={cell}>{t('rcIssuedAtLabel')}</th>
                    <th style={cell}>{t('rcExpiresAtLabel')}</th>
                    <th style={cell}>{t('rcColStatus')}</th>
                    <th style={cell}>{t('rcColRenewalFiled')}</th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map((term) => (
                    <tr key={term.id}>
                      <td style={cell}>
                        {term.licenseNumber}
                        {term.id === license.id
                          ? ` (${t('rcCurrentTerm')})`
                          : ''}
                      </td>
                      <td style={cell}>
                        {term.issuedAt ? term.issuedAt.slice(0, 10) : '—'}
                      </td>
                      <td style={cell}>{term.expiresAt.slice(0, 10)}</td>
                      <td style={cell}>
                        {t(ENUM_LABEL.BrokerLicenseStatus[term.status])}
                      </td>
                      <td style={cell}>
                        {term.renewalRequestedAt
                          ? term.renewalRequestedAt.slice(0, 10)
                          : t('rcNotFiled')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  <th style={cell}>{t('rcScopeColBranch')}</th>
                  <th style={cell}>{t('rcScopeColType')}</th>
                  {canManage ? <th style={cell} /> : null}
                </tr>
              </thead>
              <tbody>
                {scope.branches.map((branch) => (
                  <tr key={branch.id}>
                    <td style={cell}>
                      {language === 'AR' ? branch.nameAr : branch.nameEn}
                    </td>
                    <td style={cell}>
                      {t(ENUM_LABEL.InsuranceLineCategory[branch.category])}
                    </td>
                    {canManage ? (
                      <td style={cell}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => removeLicenseScopeBranch(branch.id))
                          }
                        >
                          {t('rcScopeRemove')}
                        </button>
                      </td>
                    ) : null}
                  </tr>
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
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={cell}>{t('rcCapitalRequired')}</td>
                <td style={cell} data-required-capital="">
                  {scope.capital.requiredCapital}
                </td>
              </tr>
              <tr>
                <td style={cell}>{t('rcCapitalPaidUp')}</td>
                <td style={cell}>{scope.capital.paidUpCapital ?? '—'}</td>
              </tr>
            </tbody>
          </table>

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
            <table style={{ borderCollapse: 'collapse', minWidth: '46rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('rcObligationLabel')}</th>
                  <th style={head}>{t('rcColDue')}</th>
                  <th style={head}>{t('rcColStatus')}</th>
                  <th style={head}>{t('rcColEvidence')}</th>
                  <th style={head}>{t('rcColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={cell}>{it.obligationName}</td>
                    <td style={cell}>
                      {it.dueDate.slice(0, 10)}
                      {it.isOverdue ? ' (overdue)' : ''}
                    </td>
                    <td style={cell}>
                      {it.isSubmitted ? 'submitted' : 'pending'}
                    </td>
                    <td style={cell}>{it.evidenceOfSubmissionRef ?? '—'}</td>
                    <td style={cell}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
