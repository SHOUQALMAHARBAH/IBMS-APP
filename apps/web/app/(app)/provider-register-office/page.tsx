'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth/auth-context';
import { ApiError } from '../../../lib/auth/api-client';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { SelectedValueDescription } from '../../../components/ui/SelectedValueDescription';
import {
  loadIndependently,
  namedFailures,
} from '../../../lib/load-independently';
import {
  getReferenceData,
  listStandardInsuranceLines,
  registerBrokerageOffice,
  type InsuranceLineOption,
  type ReferenceData,
  type ReferenceRow,
  type RegisteredOffice,
} from '../../../lib/provider/office-registration-api';

/**
 * MODULE 0-ب ITEM (d) — THE REGISTRATION SCREEN, SECTIONED BY THE DICTIONARY'S OWN GROUPS.
 *
 * Seven sections in the broker sheet's own order: basic identity, licence, address and contact, key
 * people, regulatory guarantees, banking, and the platform's own addressing. Following the
 * dictionary rather than regrouping by what is convenient to render is deliberate — the person
 * filling this in has the sheet or the certificate in front of them, and a form that reorders the
 * fields makes them hunt.
 *
 * ## THREE THINGS THIS SCREEN DOES NOT ASK FOR, AND SAYS SO
 *
 * Licence STATUS, the licensed TYPES, and who created the record. Each has a one-line note where the
 * field would have been, because an absent field reads as an oversight and a stated absence reads as
 * a decision — and all three are decisions (71, 67, and "a caller who could set created_by could
 * attribute the registration of a tenant to somebody else").
 *
 * ## WHAT IT WARNS ABOUT AND NEVER BLOCKS
 *
 * Capital below art. 4/a's summed requirement, and an expiry that is not a 31 December. Both appear
 * AFTER a successful registration, on the result panel, because both are facts about the office that
 * was just created rather than reasons to refuse it. The office arrives holding a licence the CBJ has
 * already granted; refusing it on our own arithmetic would leave a licensed brokerage unable to exist
 * on the platform at all.
 */

const sectionStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
};
const legendStyle: CSSProperties = {
  fontWeight: 600,
  padding: '0 0.4rem',
};
const fieldRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
  gap: '0.75rem',
  marginBottom: '0.5rem',
};
const noteStyle: CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--ink-muted)',
  margin: '0.25rem 0 0.75rem',
};

type Form = Record<string, string>;

const EMPTY: Form = {
  code: '',
  legalNameAr: '',
  legalName: '',
  tradeName: '',
  legalFormId: '',
  nationalEstablishmentNo: '',
  commercialRegistrationNo: '',
  commercialRegistrationDate: '',
  taxNumber: '',
  brokerageKind: 'DIRECT',
  brokerKind: 'CORPORATE',
  licenseNumber: '',
  licensingAuthorityId: '',
  licenseIssuedAt: '',
  licenseExpiresAt: '',
  certificateFileName: '',
  certificateStorageRef: '',
  premisesTenureFileName: '',
  premisesTenureStorageRef: '',
  associationMembershipFileName: '',
  associationMembershipStorageRef: '',
  countryId: '',
  cityId: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  generalManagerName: '',
  complianceOfficerName: '',
  complianceOfficerEmail: '',
  complianceOfficerPhone: '',
  bankGuaranteeNo: '',
  bankGuaranteeBankId: '',
  bankGuaranteeAmount: '',
  bankGuaranteeExpiry: '',
  piPolicyNumber: '',
  piInsurerName: '',
  piCoverageLimit: '',
  piExpiresAt: '',
  paidUpCapital: '',
  bankId: '',
  iban: '',
  currencyId: '',
  subdomain: '',
};

export default function RegisterBrokerageOfficePage() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [lines, setLines] = useState<InsuranceLineOption[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisteredOffice | null>(null);

  const canRegister = hasPermission(user, 'provider.office.register');

  /** The row's own language. A reference list carries both scripts and the reader gets theirs. */
  const nameOf = useCallback(
    (row: ReferenceRow) => (language === 'AR' ? row.nameAr : row.nameEn),
    [language],
  );

  useEffect(() => {
    if (!canRegister) return;
    void (async () => {
      /*
       * ONE REFUSED LIST MUST NOT DISCARD THE LISTS THAT ARRIVED.
       *
       * This was `Promise.all`, which rejects on the first rejection and throws away every value
       * that resolved. `GET /insurance-lines` was gated on `insurer.read` — an OFFICE permission the
       * platform operator does not hold — so one 403 discarded the seven reference lists that had
       * loaded perfectly, and the form rendered with nothing selectable in legal form, licensing
       * authority, country, city, bank, currency, business model or licensed branches, under one
       * sentence that named none of them.
       *
       * The route's gate is widened now, so this particular refusal is gone. The SHAPE is what is
       * fixed here, because the gate being right today does not make the next one right: a list
       * added later, or a route re-gated, puts the same eight empty pickers back.
       *
       * `loadIndependently` keeps what resolved and NAMES what did not. The naming is the half that
       * cost a session — a person can act on "the insurance-branches list did not load" and cannot
       * act on "could not load".
       */
      const { values, failures } = await loadIndependently([
        {
          key: 'reference',
          label: t('regOfficeListReference'),
          load: getReferenceData,
        },
        {
          key: 'lines',
          label: t('regOfficeListLines'),
          load: listStandardInsuranceLines,
        },
      ]);
      if (values.reference) setReference(values.reference as ReferenceData);
      if (values.lines) setLines(values.lines as InsuranceLineOption[]);
      setLoadError(
        failures.length === 0
          ? null
          : `${t('commonListsMissing')} ${namedFailures(failures)}`,
      );
    })();
  }, [canRegister, t]);

  if (!canRegister) {
    return (
      <main style={pageStyle}>
        <h1>{t('regOfficeHeading')}</h1>
        <p role="status">
          {permissionRefusal(t, 'regOfficeRefusalAct', 'provider.office.register')}
        </p>
      </main>
    );
  }

  const set = (key: string) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const text = (
    key: string,
    label: string,
    opts: { type?: string; required?: boolean } = {},
  ) => (
    <label key={key} style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.9rem' }}>{label}</span>
      <input
        name={key}
        data-field={key}
        type={opts.type ?? 'text'}
        required={opts.required ?? false}
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
        style={{ width: '100%' }}
      />
    </label>
  );

  const picker = (
    key: string,
    label: string,
    rows: ReferenceRow[],
    required = true,
  ) => (
    <label key={key} style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.9rem' }}>{label}</span>
      <select
        name={key}
        data-field={key}
        required={required}
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
        style={{ width: '100%' }}
      >
        <option value="">—</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {nameOf(row)}
          </option>
        ))}
      </select>
      {/* The chosen value's own Arabic description. See the component for why it is here and not
          beside the label: the belief that a choice matters forms when the choice is made. */}
      <SelectedValueDescription rows={rows} selectedId={form[key]} field={key} />
    </label>
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const optional = (key: string) =>
        form[key].trim() === '' ? undefined : form[key].trim();
      const registered = await registerBrokerageOffice({
        code: form.code.trim(),
        legalName: form.legalName.trim(),
        legalNameAr: form.legalNameAr.trim(),
        tradeName: optional('tradeName'),
        legalFormId: form.legalFormId,
        nationalEstablishmentNo: form.nationalEstablishmentNo.trim(),
        commercialRegistrationNo: form.commercialRegistrationNo.trim(),
        commercialRegistrationDate: optional('commercialRegistrationDate'),
        taxNumber: form.taxNumber.trim(),
        subdomain: form.subdomain.trim(),
        brokerageKind: form.brokerageKind as 'DIRECT' | 'REINSURANCE',
        brokerKind: form.brokerKind as 'NATURAL_PERSON' | 'CORPORATE',
        licenseNumber: form.licenseNumber.trim(),
        licensingAuthorityId: form.licensingAuthorityId,
        licenseIssuedAt: form.licenseIssuedAt,
        licenseExpiresAt: form.licenseExpiresAt,
        certificateFileName: form.certificateFileName.trim(),
        certificateStorageRef: form.certificateStorageRef.trim(),
        licensedLineIds: selectedLines,
        premisesTenureFileName: optional('premisesTenureFileName'),
        premisesTenureStorageRef: optional('premisesTenureStorageRef'),
        associationMembershipFileName: optional('associationMembershipFileName'),
        associationMembershipStorageRef: optional(
          'associationMembershipStorageRef',
        ),
        countryId: form.countryId,
        cityId: form.cityId,
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        website: optional('website'),
        generalManagerName: form.generalManagerName.trim(),
        complianceOfficerName: form.complianceOfficerName.trim(),
        complianceOfficerEmail: form.complianceOfficerEmail.trim(),
        complianceOfficerPhone: optional('complianceOfficerPhone'),
        bankGuaranteeNo: optional('bankGuaranteeNo'),
        bankGuaranteeBankId: optional('bankGuaranteeBankId'),
        bankGuaranteeAmount: optional('bankGuaranteeAmount'),
        bankGuaranteeExpiry: optional('bankGuaranteeExpiry'),
        piPolicyNumber: form.piPolicyNumber.trim(),
        piInsurerName: form.piInsurerName.trim(),
        piCoverageLimit: form.piCoverageLimit.trim(),
        piExpiresAt: form.piExpiresAt,
        paidUpCapital: optional('paidUpCapital'),
        bankId: form.bankId,
        iban: form.iban.trim(),
        currencyId: form.currencyId,
      });
      setResult(registered);
      setForm(EMPTY);
      setSelectedLines([]);
    } catch (error) {
      // The SERVER'S OWN SENTENCE, never a generic one. Four different refusals reach here and each
      // names what to do about it — a screen that replaced them with "could not register" would make
      // a duplicate establishment number indistinguishable from an art. 3/a breach.
      setSubmitError(
        error instanceof ApiError ? error.message : t('regOfficeLoadError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <main style={pageStyle}>
        <h1>{t('regOfficeSuccessHeading')}</h1>
        <p data-testid="registered-office">
          {result.legalNameAr} · {result.legalName} ({result.code})
        </p>
        <p data-testid="administrator-grants">
          {t('regOfficeSuccessAdministrator', {
            count: String(result.administratorGrantCount),
          })}
        </p>
        <p data-testid="licensed-types">
          {t('regOfficeSuccessTypes', { types: result.licensedTypes.join(', ') })}
        </p>

        {/*
          * DECISION 88 — THE MARKER. It NAMES what is missing and never counts it, and every word of
          * it states what THIS SYSTEM holds. It is forbidden to say or imply that the office fails
          * art. 10/a: an office licensed by the Central Bank has already submitted these documents to
          * the regulator, so our not holding a copy is OUR gap. A marker worded the other way would be
          * the system making a false regulatory finding against a compliant office.
          *
          * It GATES NOTHING — not sign-in, not role creation, not anything. A marker and a report.
          */}
        <section style={sectionStyle} data-testid="registration-pack">
          <h2>{t('regOfficePackHeading')}</h2>
          {result.registrationPack.complete ? (
            <p role="status" data-testid="registration-pack-complete">
              {t('regOfficePackComplete')}
            </p>
          ) : (
            <>
              <p role="status" data-testid="registration-pack-missing">
                {t('regOfficePackMissingIntro')}{' '}
                {result.registrationPack.missing
                  .map((key) =>
                    key === 'premisesTenure'
                      ? t('regOfficePackPremisesTenure')
                      : t('regOfficePackAssociation'),
                  )
                  .join(' · ')}{' '}
                — {t('regOfficePackNotHeld')}
              </p>
              <p style={noteStyle} data-testid="registration-pack-scope">
                {t('regOfficePackScope')}
              </p>
            </>
          )}
        </section>

        <section style={sectionStyle} data-testid="capital-assessment">
          <h2>{t('regOfficePaidUpCapital')}</h2>
          {/* On the RESULT panel too, where the figure is a statement about an office that now
              exists. A caveat shown only on the form would vanish at exactly the point the number
              starts being quoted. */}
          <p role="status" data-testid="capital-counting-unit-unverified">
            {t('rcCapitalCountingUnitUnverified')}
          </p>
          <p>
            {t('regOfficeCapitalRequired')}: {result.capital.requiredCapital}
          </p>
          {/* THREE STATES, NOT TWO. "Nobody typed a figure" and "the figure is short" are different
              facts about an office, and the second is an accusation the first does not support. */}
          {result.capital.capitalIsUnrecorded ? (
            <p role="status" data-testid="capital-unrecorded">
              {t('regOfficeCapitalUnrecorded')}
            </p>
          ) : (
            <>
              <p>
                {t('regOfficeCapitalRecorded')}: {result.capital.paidUpCapital}
              </p>
              {!result.capital.meetsRequirement && (
                <p role="status" data-testid="capital-short">
                  {t('regOfficeCapitalShort')} ({t('regOfficeCapitalShortfall')}:{' '}
                  {result.capital.shortfall})
                </p>
              )}
            </>
          )}
        </section>

        {!result.expiryIsEndOfCalendarYear && (
          <p role="status" data-testid="expiry-not-year-end">
            {t('regOfficeExpiryNotYearEnd')}
          </p>
        )}
        {result.expiryMatchesThreeYearTerm === false && (
          <p role="status" data-testid="expiry-not-three-years">
            {t('regOfficeExpiryNotThreeYears')}
          </p>
        )}

        <button type="button" onClick={() => setResult(null)}>
          {t('regOfficeRegisterAnother')}
        </button>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>{t('regOfficeHeading')}</h1>
      <p>{t('regOfficeIntro')}</p>
      <p role="status" data-testid="tenant-warning">
        {t('regOfficeTenantWarning')}
      </p>

      {loadError && (
        <p role="alert" style={errorStyle} data-testid="reference-load-error">
          {loadError}
        </p>
      )}

      <form onSubmit={onSubmit}>
        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionIdentity')}</legend>
          <div style={fieldRow}>
            {text('code', t('regOfficeCode'), { required: true })}
            {text('legalNameAr', t('regOfficeLegalNameAr'), { required: true })}
            {text('legalName', t('regOfficeLegalNameEn'), { required: true })}
            {text('tradeName', t('regOfficeTradeName'))}
            {picker(
              'legalFormId',
              t('regOfficeLegalForm'),
              reference?.legalForms ?? [],
            )}
            {text(
              'nationalEstablishmentNo',
              t('regOfficeNationalEstablishmentNo'),
              { required: true },
            )}
            {text('commercialRegistrationNo', t('regOfficeCrNo'), {
              required: true,
            })}
            {text('commercialRegistrationDate', t('regOfficeCrDate'), {
              type: 'date',
            })}
            {text('taxNumber', t('regOfficeTaxNo'), { required: true })}
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionLicence')}</legend>
          <div style={fieldRow}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: '0.9rem' }}>
                {t('regOfficeBrokerageKind')}
              </span>
              <select
                name="brokerageKind"
                data-field="brokerageKind"
                value={form.brokerageKind}
                onChange={(e) => set('brokerageKind')(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="DIRECT">DIRECT</option>
                <option value="REINSURANCE">REINSURANCE</option>
              </select>
              {/*
                * DECLARED ON SCREEN, because the field is collected and carries no consequence.
                * No guard reads it, and this product holds no text for reinsurance brokerage — so
                * a reader choosing REINSURANCE must not believe the system will treat the office
                * differently. Saying so here is the same rule as the derived-status note above: an
                * unstated absence reads as a feature, a stated one reads as a decision.
                */}
              <span
                data-testid="brokerage-kind-note"
                style={{ display: 'block', fontSize: '0.8rem', opacity: 0.85 }}
              >
                {t('regOfficeBrokerageKindNote')}
              </span>
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: '0.9rem' }}>
                {t('regOfficeBrokerKind')}
              </span>
              <select
                name="brokerKind"
                data-field="brokerKind"
                value={form.brokerKind}
                onChange={(e) => set('brokerKind')(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="CORPORATE">CORPORATE</option>
                <option value="NATURAL_PERSON">NATURAL_PERSON</option>
              </select>
            </label>
            {text('licenseNumber', t('regOfficeLicenseNo'), { required: true })}
            {picker(
              'licensingAuthorityId',
              t('regOfficeLicensingAuthority'),
              reference?.licensingAuthorities ?? [],
            )}
            {text('licenseIssuedAt', t('regOfficeLicenseIssuedAt'), {
              type: 'date',
              required: true,
            })}
            {text('licenseExpiresAt', t('regOfficeLicenseExpiresAt'), {
              type: 'date',
              required: true,
            })}
            {text('certificateFileName', t('regOfficeCertificateFileName'), {
              required: true,
            })}
            {text('certificateStorageRef', t('regOfficeCertificateStorageRef'), {
              required: true,
            })}
          </div>

          <fieldset>
            <legend>{t('regOfficeLicensedLines')}</legend>
            <p style={noteStyle}>{t('regOfficeLicensedLinesHint')}</p>
            {lines.map((line) => (
              <label
                key={line.id}
                style={{ display: 'inline-block', marginInlineEnd: '1rem' }}
              >
                <input
                  type="checkbox"
                  data-line={line.code}
                  checked={selectedLines.includes(line.id)}
                  onChange={(e) =>
                    setSelectedLines((current) =>
                      e.target.checked
                        ? [...current, line.id]
                        : current.filter((id) => id !== line.id),
                    )
                  }
                />{' '}
                {language === 'AR' ? line.nameAr : line.nameEn}
              </label>
            ))}
          </fieldset>

          {/* A STATED ABSENCE, not a missing field. Decision 71: licence status is derived and has
              no column, and a form that simply omitted it would read as an oversight. */}
          <p style={noteStyle} data-testid="status-derived-note">
            {t('regOfficeStatusDerivedNote')}
          </p>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionAddress')}</legend>
          <div style={fieldRow}>
            {picker(
              'countryId',
              t('regOfficeCountry'),
              reference?.countries ?? [],
            )}
            {picker('cityId', t('regOfficeCity'), reference?.cities ?? [])}
            {text('address', t('regOfficeAddress'), { required: true })}
            {text('phone', t('regOfficePhone'), { required: true })}
            {text('email', t('regOfficeEmail'), {
              type: 'email',
              required: true,
            })}
            {text('website', t('regOfficeWebsite'))}
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionPeople')}</legend>
          <p style={noteStyle}>{t('regOfficePeopleNote')}</p>
          <div style={fieldRow}>
            {text('generalManagerName', t('regOfficeGmName'), {
              required: true,
            })}
            {text('complianceOfficerName', t('regOfficeComplianceOfficerName'), {
              required: true,
            })}
            {text(
              'complianceOfficerEmail',
              t('regOfficeComplianceOfficerEmail'),
              { type: 'email', required: true },
            )}
            {text(
              'complianceOfficerPhone',
              t('regOfficeComplianceOfficerPhone'),
            )}
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionGuarantees')}</legend>
          <p style={noteStyle} data-testid="guarantee-note">
            {t('regOfficeGuaranteeNote')}
          </p>
          <div style={fieldRow}>
            {text('bankGuaranteeNo', t('regOfficeBankGuaranteeNo'))}
            {picker(
              'bankGuaranteeBankId',
              t('regOfficeBankGuaranteeBank'),
              reference?.banks ?? [],
              false,
            )}
            {text('bankGuaranteeAmount', t('regOfficeBankGuaranteeAmount'))}
            {text('bankGuaranteeExpiry', t('regOfficeBankGuaranteeExpiry'), {
              type: 'date',
            })}
          </div>
          <p style={noteStyle} data-testid="pi-note">
            {t('regOfficePiNote')}
          </p>
          <div style={fieldRow}>
            {text('piPolicyNumber', t('regOfficePiPolicyNo'), {
              required: true,
            })}
            {text('piInsurerName', t('regOfficePiInsurerName'), {
              required: true,
            })}
            {text('piCoverageLimit', t('regOfficePiLimit'), { required: true })}
            {text('piExpiresAt', t('regOfficePiExpiry'), {
              type: 'date',
              required: true,
            })}
          </div>
          <p style={noteStyle} data-testid="capital-note">
            {t('regOfficeCapitalNote')}
          </p>
          {/* The SAME key as `/regulatory-compliance`, not a second sentence: one unsettled fact, one
              wording. Both screens display a figure computed from the same function, so a reader
              moving between them must not meet two different accounts of how settled it is. */}
          <p style={noteStyle} data-testid="capital-counting-unit-unverified">
            {t('rcCapitalCountingUnitUnverified')}
          </p>
          <div style={fieldRow}>
            {text('paidUpCapital', t('regOfficePaidUpCapital'))}
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionBanking')}</legend>
          <div style={fieldRow}>
            {picker('bankId', t('regOfficeBank'), reference?.banks ?? [])}
            {text('iban', t('regOfficeIban'), { required: true })}
            {picker(
              'currencyId',
              t('regOfficeCurrency'),
              reference?.currencies ?? [],
            )}
          </div>
          <p style={noteStyle}>{t('regOfficeIbanNote')}</p>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionPack')}</legend>
          {/* DECISION 88 — BOTH OPTIONAL. Absence does not block the save; it makes the derived
              registration pack incomplete, and the marker on the result panel names what is missing
              in words that state what WE hold. */}
          <p style={noteStyle} data-testid="registration-pack-note">
            {t('regOfficePackNote')}
          </p>
          <div style={fieldRow}>
            {text(
              'premisesTenureFileName',
              t('regOfficePremisesTenureFileName'),
            )}
            {text(
              'premisesTenureStorageRef',
              t('regOfficePremisesTenureStorageRef'),
            )}
            {text(
              'associationMembershipFileName',
              t('regOfficeAssociationFileName'),
            )}
            {text(
              'associationMembershipStorageRef',
              t('regOfficeAssociationStorageRef'),
            )}
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regOfficeSectionPlatform')}</legend>
          <div style={fieldRow}>
            {text('subdomain', t('regOfficeSubdomain'), { required: true })}
          </div>
          <p style={noteStyle}>{t('regOfficeSubdomainHint')}</p>
        </fieldset>

        {submitError && (
          <p role="alert" style={errorStyle} data-testid="submit-error">
            {submitError}
          </p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? t('regOfficeSubmitting') : t('regOfficeSubmit')}
        </button>
      </form>
    </main>
  );
}
