'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth/auth-context';
import { ApiError } from '../../../lib/auth/api-client';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import {
  ErrorState,
  PageHeader,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import {
  getReferenceData,
  listStandardInsuranceLines,
  registerInsuranceCompany,
  type InsuranceLineOption,
  type ReferenceData,
  type ReferenceRow,
  type RegisteredInsuranceCompany,
} from '../../../lib/provider/office-registration-api';
import { SelectedValueDescription } from '../../../components/ui/SelectedValueDescription';
import {
  loadIndependently,
  namedFailures,
} from '../../../lib/load-independently';

/**
 * MODULE 0-ب ITEM (e) — REGISTERING AN INSURANCE COMPANY, sectioned by the dictionary's own groups.
 *
 * ## WHAT THE OWNER'S YARDSTICK ASKS OF EVERY FIELD HERE
 *
 * Could the broker do this on paper today, and does the system ask for anything the paper did not?
 * Every field below is on the insurer sheet, so the answer is the sheet itself — except `subdomain`,
 * which is this platform's own addressing and is labelled as such in one sentence.
 *
 * ## WHAT IS DELIBERATELY NOT ON THIS FORM
 *
 * Thirteen of the sheet's 38, and the screen SAYS SO rather than leaving thirteen apparent gaps. The
 * financial strength rating, its agency, its as-of date and the three broker-relations fields are
 * OFFICE data — each office deals with a different named person inside the same company and records
 * its own rating — so they are typed on `/insurers/[id]`, not here. The licence status is derived.
 *
 * ## DECISION 90 — NO DATABASE CONSTRAINT IS EVER THE ERROR MESSAGE
 *
 * The server produces a sentence for every constraint reachable from this screen, and this screen
 * renders THAT SENTENCE rather than a generic one. Six distinct refusals arrive here and each names
 * what to do; replacing them with "could not register" would make a duplicate establishment number
 * indistinguishable from an API integration missing its endpoint.
 */

const sectionStyle: CSSProperties = {
  /* `--border-default` — `--border` is defined nowhere, so this section had no outline at all.
   * See the surfaces note in globals.css. */
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
};
const legendStyle: CSSProperties = { fontWeight: 600, padding: '0 0.4rem' };
const fieldRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
  gap: 'var(--space-3)',
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
  shortName: '',
  legalFormId: '',
  nationalEstablishmentNo: '',
  commercialRegistrationNo: '',
  taxNumber: '',
  insurerLicenseNumber: '',
  insurerLicenseExpiresAt: '',
  insurerLicenseIssuedAt: '',
  licensingAuthorityId: '',
  businessModelId: '',
  certificateFileName: '',
  certificateStorageRef: '',
  countryId: '',
  cityId: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  quotationEmail: '',
  claimsEmail: '',
  integrationMethod: 'EMAIL',
  apiEndpoint: '',
  bankId: '',
  iban: '',
  subdomain: '',
};

export default function RegisterInsuranceCompanyPage() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [lines, setLines] = useState<InsuranceLineOption[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisteredInsuranceCompany | null>(null);

  const canRegister = hasPermission(user, 'provider.insurer.register');

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
      <main style={pageStackStyle}>
        <PageHeader title={t('regInsHeading')} />
        <p role="status">
          {permissionRefusal(t, 'regInsRefusalAct', 'provider.insurer.register')}
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

  const picker = (key: string, label: string, rows: ReferenceRow[]) => (
    <label key={key} style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.9rem' }}>{label}</span>
      <select
        name={key}
        data-field={key}
        required
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
      {/* See SelectedValueDescription: the owner's reason for these lines decides the placement. */}
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
      const registered = await registerInsuranceCompany({
        code: form.code.trim(),
        legalNameAr: form.legalNameAr.trim(),
        legalName: form.legalName.trim(),
        shortName: form.shortName.trim(),
        legalFormId: form.legalFormId,
        nationalEstablishmentNo: form.nationalEstablishmentNo.trim(),
        commercialRegistrationNo: form.commercialRegistrationNo.trim(),
        taxNumber: form.taxNumber.trim(),
        insurerLicenseNumber: form.insurerLicenseNumber.trim(),
        insurerLicenseExpiresAt: form.insurerLicenseExpiresAt,
        // OMITTED rather than sent empty when it is blank: the DTO treats it as optional through
        // `emptyStringToUndefined`, and sending '' would reach `IsCalendarDate` as a value and be
        // refused — which is how an optional field becomes mandatory by accident.
        ...(form.insurerLicenseIssuedAt
          ? { insurerLicenseIssuedAt: form.insurerLicenseIssuedAt }
          : {}),
        licensingAuthorityId: form.licensingAuthorityId,
        businessModelId: form.businessModelId,
        licensedLineIds: selectedLines,
        certificateFileName: form.certificateFileName.trim(),
        certificateStorageRef: form.certificateStorageRef.trim(),
        countryId: form.countryId,
        cityId: form.cityId,
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        website: optional('website'),
        quotationEmail: form.quotationEmail.trim(),
        claimsEmail: form.claimsEmail.trim(),
        integrationMethod: form.integrationMethod as
          | 'API'
          | 'PORTAL'
          | 'EMAIL'
          | 'MANUAL',
        apiEndpoint: optional('apiEndpoint'),
        bankId: form.bankId,
        iban: form.iban.trim(),
        subdomain: form.subdomain.trim(),
      });
      setResult(registered);
      setForm(EMPTY);
      setSelectedLines([]);
    } catch (error) {
      // THE SERVER'S OWN SENTENCE. Six distinct refusals reach here and each names what to do — a
      // generic message would make a duplicate establishment number indistinguishable from an API
      // integration missing its endpoint, and the two need different people to fix them.
      setSubmitError(
        error instanceof ApiError ? error.message : t('regOfficeLoadError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <main style={pageStackStyle}>
        <PageHeader title={t('regInsSuccessHeading')} />
        <p data-testid="registered-company">
          {result.legalNameAr} · {result.legalName} ({result.code})
        </p>
        <p data-testid="licensed-lines">
          {t('regInsSuccessLines', { count: String(result.licensedLineCount) })}
        </p>
        <p data-testid="licensed-categories">
          {t('regInsSuccessCategories', {
            types: result.licensedCategories.join(', '),
          })}
        </p>
        <button type="button" onClick={() => setResult(null)}>
          {t('regInsRegisterAnother')}
        </button>
      </main>
    );
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('regInsHeading')} />
      <p>{t('regInsIntro')}</p>
      <p role="status" data-testid="tenant-warning">
        {t('regInsTenantWarning')}
      </p>

      {loadError && (
        <ErrorState title={loadError} data-testid="reference-load-error" />
      )}

      <form onSubmit={onSubmit}>
        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regInsSectionIdentity')}</legend>
          <div style={fieldRow}>
            {text('code', t('regInsCode'), { required: true })}
            {text('legalNameAr', t('regOfficeLegalNameAr'), { required: true })}
            {text('legalName', t('regOfficeLegalNameEn'), { required: true })}
            {text('shortName', t('regInsShortName'), { required: true })}
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
            {text('taxNumber', t('regOfficeTaxNo'), { required: true })}
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regInsSectionLicence')}</legend>
          <div style={fieldRow}>
            {text('insurerLicenseNumber', t('regInsLicenseNo'), {
              required: true,
            })}
            {/*
              BATCH 5 GROUP 7d — THE TWO DATES, which is what makes the licence standing derivable.
              Without them the term columns would be unpopulatable by any path, which is the
              capability-nobody-can-exercise class this module has measured twice.

              THE EXPIRY IS REQUIRED and the issue date is not: the expiry is the only date the
              derivation cannot do without, while a certificate may not print an issue date at all —
              the same judgement `BrokerLicense.issuedAt` already makes.
            */}
            {text('insurerLicenseExpiresAt', t('regInsLicenseExpiry'), {
              type: 'date',
              required: true,
            })}
            {text('insurerLicenseIssuedAt', t('regInsLicenseIssued'), {
              type: 'date',
            })}
            {picker(
              'licensingAuthorityId',
              t('regOfficeLicensingAuthority'),
              reference?.licensingAuthorities ?? [],
            )}
            {picker(
              'businessModelId',
              t('regInsBusinessModel'),
              reference?.businessModels ?? [],
            )}
            {text('certificateFileName', t('regInsCertificateFileName'), {
              required: true,
            })}
            {text('certificateStorageRef', t('regInsCertificateStorageRef'), {
              required: true,
            })}
          </div>

          <fieldset>
            <legend>{t('regInsLicensedLines')}</legend>
            {/* THE TWO-SOURCE RULE, ON THE SCREEN. `InsurerDirectory.lines` shows what offices have
                recorded BUYING; this is what the licence PERMITS. They render identically and
                diverge in both directions, so each surface says which it is showing. */}
            <p style={noteStyle} data-testid="licensed-lines-hint">
              {t('regInsLicensedLinesHint')}
            </p>
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

          <p style={noteStyle} data-testid="status-derived-note">
            {t('regOfficeStatusDerivedNote')}
          </p>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regInsSectionAddress')}</legend>
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
            {text('quotationEmail', t('regInsQuotationEmail'), {
              type: 'email',
              required: true,
            })}
            {text('claimsEmail', t('regInsClaimsEmail'), {
              type: 'email',
              required: true,
            })}
          </div>
          {/* THE THIRTEEN FIELDS THAT ARE NOT HERE, SAID OUT LOUD. An absent field reads as an
              oversight; a stated absence reads as a decision — and this one is decision 63. */}
          <p style={noteStyle} data-testid="office-scoped-note">
            {t('regInsPublishedChannelsNote')}
          </p>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regInsSectionIntegration')}</legend>
          <div style={fieldRow}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: '0.9rem' }}>
                {t('regInsIntegrationMethod')}
              </span>
              <select
                name="integrationMethod"
                data-field="integrationMethod"
                value={form.integrationMethod}
                onChange={(e) => set('integrationMethod')(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="EMAIL">
                  {t(ENUM_LABEL.IntegrationMethod.EMAIL)}
                </option>
                <option value="PORTAL">
                  {t(ENUM_LABEL.IntegrationMethod.PORTAL)}
                </option>
                <option value="API">
                  {t(ENUM_LABEL.IntegrationMethod.API)}
                </option>
                <option value="MANUAL">
                  {t(ENUM_LABEL.IntegrationMethod.MANUAL)}
                </option>
              </select>
            </label>
            {text('apiEndpoint', t('regInsApiEndpoint'))}
          </div>
          <p style={noteStyle} data-testid="api-endpoint-hint">
            {t('regInsApiEndpointHint')}
          </p>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regInsSectionBanking')}</legend>
          <div style={fieldRow}>
            {picker('bankId', t('regOfficeBank'), reference?.banks ?? [])}
            {text('iban', t('regOfficeIban'), { required: true })}
          </div>
          <p style={noteStyle}>{t('regOfficeIbanNote')}</p>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend style={legendStyle}>{t('regInsSectionPlatform')}</legend>
          <div style={fieldRow}>
            {text('subdomain', t('regOfficeSubdomain'), { required: true })}
          </div>
          <p style={noteStyle}>{t('regOfficeSubdomainHint')}</p>
        </fieldset>

        {submitError && (
          <ErrorState title={submitError} data-testid="submit-error" />
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? t('regInsSubmitting') : t('regInsSubmit')}
        </button>
      </form>
    </main>
  );
}
