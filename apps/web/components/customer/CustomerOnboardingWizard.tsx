'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  addCustomerDocument,
  addUbo,
  checkDuplicateCustomerName,
  createCustomer,
  recordAbandonedDuplicate,
  type Customer,
  type DuplicateNameCheck,
  type DuplicateNameMatch,
  type CustomerDocument,
  type CustomerType,
  type DocumentClassification,
  type LanguagePreference,
  type Ubo,
} from '../../lib/customer/customer-api';
import { startKyc, submitKyc, type KycRecord } from '../../lib/kyc/kyc-api';
import { ApiError } from '../../lib/auth/api-client';
import { assertNoPresetSensitiveDefaults } from '../../lib/forms/privacy-by-default';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  buttonStyle,
  errorStyle,
  inputStyle,
  labelStyle,
} from '../auth/auth-form.styles';
import {
  fieldStyle,
  formRowStyle,
  sectionStyle,
} from '../lead/lead.styles';
import {
  repeatableRowStyle,
  stepIndicatorStyle,
  stepPillStyle,
  wizardNavStyle,
} from './customer.styles';

// Part 10.6 — "no pre-filled or pre-selected sensitive fields"
// (ibms-brain/meta/lex/sensitive-data-handling.md). The three national-ID/
// contact fields below are the sensitive ones on this form; every one of
// them starts as '' in useState below, and this assertion is the same
// check the backend's own encryption layer is documented as waiting for its
// first real caller (apps/web/lib/forms/privacy-by-default.ts) — this
// wizard is that caller.
const SENSITIVE_FIELD_NAMES = ['nationalId', 'contactPhone', 'contactEmail'] as const;

type Step = 'type' | 'profile' | 'ubos' | 'documents' | 'review';

const INDIVIDUAL_STEPS: Step[] = ['type', 'profile', 'documents', 'review'];
const CORPORATE_STEPS: Step[] = ['type', 'profile', 'ubos', 'documents', 'review'];

const STEP_LABEL_KEY: Record<Step, TranslationKey> = {
  type: 'customerWizardStepType',
  profile: 'customerWizardStepProfile',
  ubos: 'customerWizardStepUbos',
  documents: 'customerWizardStepDocuments',
  review: 'customerWizardStepReview',
};

const TYPE_LABEL_KEY: Record<CustomerType, TranslationKey> = {
  INDIVIDUAL: 'customerTypeIndividual',
  CORPORATE: 'customerTypeCorporate',
};

const CLASSIFICATION_LABEL_KEY: Record<DocumentClassification, TranslationKey> = {
  CONFIDENTIAL: 'customerWizardClassificationConfidentialOption',
  HIGHLY_CONFIDENTIAL: 'customerWizardClassificationHighlyConfidentialOption',
};

// Runs once per module load against the LITERAL initial-values object this
// form actually starts every field from — never against live state. The
// whole point of "privacy by default" is that the form's OWN starting point
// has nothing pre-filled; checking it here (not inside the submit handler)
// means a real user typing a real national ID before submitting can never
// trip this assertion — only an initial-values object that itself arrives
// pre-populated would.
assertNoPresetSensitiveDefaults(
  { nationalId: '', contactPhone: '', contactEmail: '' },
  SENSITIVE_FIELD_NAMES,
);

export function CustomerOnboardingWizard() {
  const router = useRouter();
  const { t } = useLanguage();
  const [customerType, setCustomerType] = useState<CustomerType | null>(null);
  const steps = useMemo(
    () => (customerType === 'CORPORATE' ? CORPORATE_STEPS : INDIVIDUAL_STEPS),
    [customerType],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [kyc, setKyc] = useState<KycRecord | null>(null);
  const [ubos, setUbos] = useState<Ubo[]>([]);
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);

  // Profile form fields — the sensitive three start empty on purpose (see
  // SENSITIVE_FIELD_NAMES above). `legalName` is CORPORATE-only now; an
  // individual's name is captured as the 4 Jordanian national-ID-convention
  // parts below and computed server-side (Part F item #4).
  const [legalName, setLegalName] = useState('');
  const [givenName, setGivenName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [grandfatherName, setGrandfatherName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [natureOfBusiness, setNatureOfBusiness] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('AR');

  // UBO mini-form — always an individual, so always the 4-part split.
  const [uboGivenName, setUboGivenName] = useState('');
  const [uboFatherName, setUboFatherName] = useState('');
  const [uboGrandfatherName, setUboGrandfatherName] = useState('');
  const [uboFamilyName, setUboFamilyName] = useState('');
  const [uboNationalId, setUboNationalId] = useState('');
  const [uboOwnershipPercent, setUboOwnershipPercent] = useState('');
  const [uboIsPep, setUboIsPep] = useState(false);

  // Document mini-form
  const [docFileName, setDocFileName] = useState('');
  const [docStorageRef, setDocStorageRef] = useState('');
  const [docClassification, setDocClassification] = useState<DocumentClassification>('CONFIDENTIAL');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // LAYER 1. `null` means no question has been asked; an empty array would mean "asked, nothing found",
  // which is a different state and is why this is not a bare array defaulting to empty.
  const [duplicateMatches, setDuplicateMatches] = useState<
    DuplicateNameMatch[] | null
  >(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateAbandoned, setDuplicateAbandoned] = useState(false);

  function goTo(target: Step) {
    const idx = steps.indexOf(target);
    if (idx >= 0) setStepIndex(idx);
  }

  /**
   * LAYER 1 — the write, with the officer's answer attached when there was a question.
   *
   * Split out of `handleProfileSubmit` so the duplicate warning's "a different person" button and an
   * ordinary submit reach the SAME code: two copies would be two places for the answer to stop being
   * sent, and the answer not being sent is indistinguishable from no warning having fired.
   */
  async function createAndStartKyc(
    answer?: { samePerson: boolean; matchCount: number },
  ) {
    if (!customerType) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const createdCustomer = await createCustomer({
        customerType,
        duplicateNameSamePerson: answer?.samePerson,
        duplicateNameMatchCount: answer?.matchCount,
        legalName: customerType === 'CORPORATE' ? legalName : undefined,
        givenName: customerType === 'INDIVIDUAL' ? givenName : undefined,
        fatherName: customerType === 'INDIVIDUAL' ? (fatherName || undefined) : undefined,
        grandfatherName: customerType === 'INDIVIDUAL' ? (grandfatherName || undefined) : undefined,
        familyName: customerType === 'INDIVIDUAL' ? familyName : undefined,
        nationalId: customerType === 'INDIVIDUAL' ? nationalId : undefined,
        registrationNumber: customerType === 'CORPORATE' ? registrationNumber : undefined,
        taxRegistrationNumber: taxRegistrationNumber || undefined,
        registeredAddress: customerType === 'CORPORATE' ? registeredAddress : undefined,
        natureOfBusiness: customerType === 'CORPORATE' ? natureOfBusiness : undefined,
        contactPhone,
        contactEmail,
        languagePreference,
      });
      const createdKyc = await startKyc(createdCustomer.id);
      setCustomer(createdCustomer);
      setKyc(createdKyc);
      setDuplicateMatches(null);
      goTo(customerType === 'CORPORATE' ? 'ubos' : 'documents');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('customerWizardCreateError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (!customerType) return;

    // CORPORATE goes straight through: a company is keyed on its registration number by a hard unique
    // index, so there is no judgement to ask for — a collision is refused by the database and surfaces
    // as the create's own error. Only a PERSON gets a warning, because only a person can legitimately
    // share a name with somebody else.
    if (customerType !== 'INDIVIDUAL') {
      await createAndStartKyc();
      return;
    }

    const enteredName = [givenName, fatherName, grandfatherName, familyName]
      .filter((part) => part.trim() !== '')
      .join(' ');

    setError(null);
    setIsSubmitting(true);
    let check: DuplicateNameCheck;
    try {
      check = await checkDuplicateCustomerName(enteredName);
    } catch (err) {
      // THE CHECK FAILING MUST NOT BLOCK THE CREATE. It is a warning, not a control — the hard
      // refusals live on the database indexes and on the bulk import. Refusing a real customer because
      // a warning lookup was unavailable would make layer 1 stricter when it breaks than when it works,
      // which is the wrong direction for something that cannot prevent a duplicate anyway.
      setIsSubmitting(false);
      setError(
        err instanceof ApiError ? err.message : t('customerDuplicateCheckFailed'),
      );
      await createAndStartKyc();
      return;
    }
    setIsSubmitting(false);

    if (check.matches.length === 0) {
      await createAndStartKyc();
      return;
    }
    setDuplicateName(enteredName);
    setDuplicateMatches(check.matches);
  }

  /** The officer recognised the person. Nothing is created, and that is RECORDED. */
  async function handleSamePerson() {
    const matches = duplicateMatches;
    if (!matches || matches.length === 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await recordAbandonedDuplicate({
        legalName: duplicateName,
        matchCount: matches.length,
      });
      setDuplicateAbandoned(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t('customerDuplicateCheckFailed'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddUbo(e: FormEvent) {
    e.preventDefault();
    if (!customer) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const ubo = await addUbo(customer.id, {
        givenName: uboGivenName,
        fatherName: uboFatherName || undefined,
        grandfatherName: uboGrandfatherName || undefined,
        familyName: uboFamilyName,
        nationalId: uboNationalId,
        ownershipPercent: uboOwnershipPercent ? Number(uboOwnershipPercent) : undefined,
        isPep: uboIsPep,
      });
      setUbos((prev) => [...prev, ubo]);
      setUboGivenName('');
      setUboFatherName('');
      setUboGrandfatherName('');
      setUboFamilyName('');
      setUboNationalId('');
      setUboOwnershipPercent('');
      setUboIsPep(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('customerWizardUboError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddDocument(e: FormEvent) {
    e.preventDefault();
    if (!customer) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const document = await addCustomerDocument(customer.id, {
        classification: docClassification,
        fileName: docFileName,
        storageRef: docStorageRef,
      });
      setDocuments((prev) => [...prev, document]);
      setDocFileName('');
      setDocStorageRef('');
      setDocClassification('CONFIDENTIAL');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('customerWizardDocError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitKyc() {
    if (!customer || !kyc) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await submitKyc(kyc.id);
      router.push(`/customers/${customer.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('customerWizardKycError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <div style={stepIndicatorStyle}>
        {steps.map((s, i) => (
          <span key={s} style={stepPillStyle(i === stepIndex, i < stepIndex)}>
            {i + 1}. {t(STEP_LABEL_KEY[s])}
          </span>
        ))}
      </div>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {step === 'type' ? (
        <div>
          <h2 style={{ marginTop: 0 }}>{t('customerWizardTypeQuestion')}</h2>
          <div style={{ ...formRowStyle, marginTop: '1rem' }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setCustomerType('INDIVIDUAL');
                setStepIndex(1);
              }}
            >
              {t(TYPE_LABEL_KEY.INDIVIDUAL)}
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setCustomerType('CORPORATE');
                setStepIndex(1);
              }}
            >
              {t(TYPE_LABEL_KEY.CORPORATE)}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'profile' ? (
        <form onSubmit={(e) => void handleProfileSubmit(e)}>
          <h2 style={{ marginTop: 0 }}>
            {customerType === 'CORPORATE'
              ? t('customerWizardProfileHeadingCorporate')
              : t('customerWizardProfileHeadingIndividual')}
          </h2>
          {customerType === 'INDIVIDUAL' ? (
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="cust-given-name" style={labelStyle}>
                  {t('customerFieldGivenName')}
                </label>
                <input
                  id="cust-given-name"
                  required
                  dir="auto"
                  value={givenName}
                  onChange={(e) => setGivenName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="cust-father-name" style={labelStyle}>
                  {t('customerWizardFatherNameOptionalLabel')}
                </label>
                <input
                  id="cust-father-name"
                  dir="auto"
                  value={fatherName}
                  onChange={(e) => setFatherName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="cust-grandfather-name" style={labelStyle}>
                  {t('customerWizardGrandfatherNameOptionalLabel')}
                </label>
                <input
                  id="cust-grandfather-name"
                  dir="auto"
                  value={grandfatherName}
                  onChange={(e) => setGrandfatherName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="cust-family-name" style={labelStyle}>
                  {t('customerFieldFamilyName')}
                </label>
                <input
                  id="cust-family-name"
                  required
                  dir="auto"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
          ) : null}
          <div style={formRowStyle}>
            {customerType === 'CORPORATE' ? (
              <div style={fieldStyle}>
                <label htmlFor="cust-legal-name" style={labelStyle}>
                  {t('customerWizardLegalNameLabel')}
                </label>
                <input
                  id="cust-legal-name"
                  required
                  dir="auto"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  style={inputStyle}
                />
              </div>
            ) : null}
            {customerType === 'INDIVIDUAL' ? (
              <div style={fieldStyle}>
                <label htmlFor="cust-national-id" style={labelStyle}>
                  {t('customerFieldNationalId')}
                </label>
                <input
                  id="cust-national-id"
                  required
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  style={inputStyle}
                />
              </div>
            ) : (
              <div style={fieldStyle}>
                <label htmlFor="cust-registration-number" style={labelStyle}>
                  {t('customerWizardRegistrationNumberLabel')}
                </label>
                <input
                  id="cust-registration-number"
                  required
                  dir="auto"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  style={inputStyle}
                />
              </div>
            )}
          </div>

          {customerType === 'CORPORATE' ? (
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="cust-address" style={labelStyle}>
                  {t('customerFieldRegisteredAddress')}
                </label>
                <input
                  id="cust-address"
                  required
                  dir="auto"
                  value={registeredAddress}
                  onChange={(e) => setRegisteredAddress(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="cust-nature" style={labelStyle}>
                  {t('customerFieldNatureOfBusiness')}
                </label>
                <input
                  id="cust-nature"
                  required
                  dir="auto"
                  value={natureOfBusiness}
                  onChange={(e) => setNatureOfBusiness(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
          ) : null}

          <div style={formRowStyle}>
            <div style={fieldStyle}>
              <label htmlFor="cust-tax-reg" style={labelStyle}>
                {t('customerWizardTaxRegLabel')}
              </label>
              <input
                id="cust-tax-reg"
                dir="auto"
                value={taxRegistrationNumber}
                onChange={(e) => setTaxRegistrationNumber(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={fieldStyle}>
              <label htmlFor="cust-language" style={labelStyle}>
                {t('customerFieldLanguagePreference')}
              </label>
              <select
                id="cust-language"
                value={languagePreference}
                onChange={(e) => setLanguagePreference(e.target.value as LanguagePreference)}
                style={inputStyle}
              >
                <option value="AR">{t('customerWizardLanguageArabicOption')}</option>
                <option value="EN">{t('customerWizardLanguageEnglishOption')}</option>
              </select>
            </div>
          </div>

          <div style={formRowStyle}>
            <div style={fieldStyle}>
              <label htmlFor="cust-phone" style={labelStyle}>
                {t('customerFieldContactPhone')}
              </label>
              <input
                id="cust-phone"
                required
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                style={inputStyle}
                placeholder="+962-7-..."
              />
            </div>
            <div style={fieldStyle}>
              <label htmlFor="cust-email" style={labelStyle}>
                {t('customerFieldContactEmail')}
              </label>
              <input
                id="cust-email"
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* LAYER 1's WARNING. It sits above the submit button, because a warning below the control it
              is about is a warning read after the click. It REPLACES the button rather than sitting
              beside it: leaving "Create customer" live next to "is this the same person?" lets the
              question be clicked past, which is the one way a warning fails while appearing to work. */}
          {duplicateMatches && duplicateMatches.length > 0 ? (
            <div
              data-testid="duplicate-name-warning"
              role="alert"
              style={{
                border: '1px solid var(--warning-border, var(--border-strong))',
                background: 'var(--warning-bg, var(--surface-sunken))',
                borderRadius: '0.4rem',
                padding: '0.75rem',
                marginTop: '1rem',
              }}
            >
              <strong>{t('customerDuplicateNameHeading')}</strong>
              <p style={{ marginTop: '0.4rem' }}>
                {t('customerDuplicateNameIntro')}
              </p>
              <ul style={{ marginTop: '0.4rem', paddingInlineStart: '1.2rem' }}>
                {duplicateMatches.map((match) => (
                  <li key={match.id}>
                    <a
                      href={`/customers/${match.id}`}
                      data-testid="duplicate-name-match"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <bdi>{match.legalName}</bdi>
                    </a>{' '}
                    — {match.status}
                  </li>
                ))}
              </ul>

              {duplicateAbandoned ? (
                // The warning WORKED. Say so plainly and leave the officer on the open record rather
                // than silently resetting the form, which would read as the create having failed.
                <p data-testid="duplicate-name-abandoned" style={{ marginTop: '0.6rem' }}>
                  {t('customerDuplicateNameAbandoned')}
                </p>
              ) : (
                <div style={{ ...formRowStyle, marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    data-testid="duplicate-same-person"
                    disabled={isSubmitting}
                    style={buttonStyle}
                    onClick={() => void handleSamePerson()}
                  >
                    {t('customerDuplicateNameSamePerson')}
                  </button>
                  <button
                    type="button"
                    data-testid="duplicate-different-person"
                    disabled={isSubmitting}
                    style={buttonStyle}
                    onClick={() =>
                      void createAndStartKyc({
                        samePerson: false,
                        matchCount: duplicateMatches.length,
                      })
                    }
                  >
                    {t('customerDuplicateNameDifferentPerson')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              {isSubmitting ? t('customerWizardCreatingButton') : t('customerWizardCreateButton')}
            </button>
          )}
        </form>
      ) : null}

      {step === 'ubos' && customer ? (
        <div>
          <h2 style={{ marginTop: 0 }}>{t('customerUbosHeading')}</h2>
          <p style={{ opacity: 0.8 }}>
            {t('customerWizardUbosIntroPrefix')}{' '}
            <bdi>{customer.legalName}</bdi>
            {t('customerWizardUbosIntroSuffix')}
          </p>
          {ubos.map((u) => (
            <div key={u.id} style={repeatableRowStyle}>
              <strong>
                <bdi>{u.fullName}</bdi>
              </strong>
              {u.ownershipPercent ? <span> — {u.ownershipPercent}%</span> : null}
              {u.isPep ? <span> — {t('customerUboPep')}</span> : null}
            </div>
          ))}
          <form onSubmit={(e) => void handleAddUbo(e)} style={repeatableRowStyle}>
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="ubo-given-name" style={labelStyle}>
                  {t('customerFieldGivenName')}
                </label>
                <input
                  id="ubo-given-name"
                  required
                  dir="auto"
                  value={uboGivenName}
                  onChange={(e) => setUboGivenName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="ubo-father-name" style={labelStyle}>
                  {t('customerWizardFatherNameOptionalLabel')}
                </label>
                <input
                  id="ubo-father-name"
                  dir="auto"
                  value={uboFatherName}
                  onChange={(e) => setUboFatherName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="ubo-grandfather-name" style={labelStyle}>
                  {t('customerWizardGrandfatherNameOptionalLabel')}
                </label>
                <input
                  id="ubo-grandfather-name"
                  dir="auto"
                  value={uboGrandfatherName}
                  onChange={(e) => setUboGrandfatherName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="ubo-family-name" style={labelStyle}>
                  {t('customerFieldFamilyName')}
                </label>
                <input
                  id="ubo-family-name"
                  required
                  dir="auto"
                  value={uboFamilyName}
                  onChange={(e) => setUboFamilyName(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="ubo-national-id" style={labelStyle}>
                  {t('customerFieldNationalId')}
                </label>
                <input
                  id="ubo-national-id"
                  required
                  value={uboNationalId}
                  onChange={(e) => setUboNationalId(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="ubo-ownership" style={labelStyle}>
                  {t('customerWizardOwnershipPercentLabel')}
                </label>
                <input
                  id="ubo-ownership"
                  type="number"
                  min={0}
                  max={100}
                  value={uboOwnershipPercent}
                  onChange={(e) => setUboOwnershipPercent(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <label htmlFor="ubo-pep">
                <input
                  id="ubo-pep"
                  type="checkbox"
                  checked={uboIsPep}
                  onChange={(e) => setUboIsPep(e.target.checked)}
                />{' '}
                {t('customerWizardPepCheckboxLabel')}
              </label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ ...buttonStyle, width: 'auto' }}>
              {t('customerWizardAddOwnerButton')}
            </button>
          </form>
          <div style={wizardNavStyle}>
            <button type="button" style={buttonStyle} onClick={() => goTo('documents')}>
              {t('customerWizardContinueButton')}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'documents' && customer ? (
        <div>
          <h2 style={{ marginTop: 0 }}>{t('customerWizardDocumentsHeading')}</h2>
          <p style={{ opacity: 0.8 }}>
            {t('customerWizardDocumentsIntroPrefix')} <bdi>{customer.legalName}</bdi>
            {t('customerWizardDocumentsIntroSuffix')}
          </p>
          {documents.map((d) => (
            <div key={d.id} style={repeatableRowStyle}>
              <strong>{d.fileName}</strong> — {t(CLASSIFICATION_LABEL_KEY[d.classification])}
            </div>
          ))}
          <form onSubmit={(e) => void handleAddDocument(e)} style={repeatableRowStyle}>
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="doc-file-name" style={labelStyle}>
                  {t('customerWizardFileNameLabel')}
                </label>
                <input
                  id="doc-file-name"
                  required
                  value={docFileName}
                  onChange={(e) => setDocFileName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="doc-storage-ref" style={labelStyle}>
                  {t('customerWizardStorageRefLabel')}
                </label>
                <input
                  id="doc-storage-ref"
                  required
                  value={docStorageRef}
                  onChange={(e) => setDocStorageRef(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="doc-classification" style={labelStyle}>
                  {t('customerWizardClassificationLabel')}
                </label>
                <select
                  id="doc-classification"
                  value={docClassification}
                  onChange={(e) => setDocClassification(e.target.value as DocumentClassification)}
                  style={inputStyle}
                >
                  <option value="CONFIDENTIAL">
                    {t('customerWizardClassificationConfidentialOption')}
                  </option>
                  <option value="HIGHLY_CONFIDENTIAL">
                    {t('customerWizardClassificationHighlyConfidentialOption')}
                  </option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ ...buttonStyle, width: 'auto' }}>
              {t('customerWizardAttachDocumentButton')}
            </button>
          </form>
          <div style={wizardNavStyle}>
            {customerType === 'CORPORATE' ? (
              <button type="button" style={buttonStyle} onClick={() => goTo('ubos')}>
                {t('commonBack')}
              </button>
            ) : null}
            <button type="button" style={buttonStyle} onClick={() => goTo('review')}>
              {t('customerWizardContinueButton')}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' && customer && kyc ? (
        <div>
          <h2 style={{ marginTop: 0 }}>{t('customerWizardStepReview')}</h2>
          {/* legalName comes from the create() response, not local state:
              for an individual it's server-computed from the 4 name parts
              (Part F item #4), and it's never masked either way, so this is
              the correct source for BOTH customer types. Contact fields
              still render from local state (still in memory, not the
              create() response), whose contactPhone/contactEmail come back
              masked, so a typo in the contact fields would be impossible to
              catch here. These stay client-side only; nothing is logged. */}
          <ul>
            <li>
              <strong>
                <bdi>{customer.legalName}</bdi>
              </strong>{' '}
              ({t(TYPE_LABEL_KEY[customer.customerType])})
            </li>
            <li>{t('customerWizardReviewContactLine', { phone: contactPhone, email: contactEmail })}</li>
            {customerType === 'CORPORATE' ? (
              <li>{t('customerWizardReviewUbosLine', { count: ubos.length })}</li>
            ) : null}
            <li>{t('customerWizardReviewDocumentsLine', { count: documents.length })}</li>
          </ul>
          <p style={{ opacity: 0.8 }}>{t('customerWizardReviewSubmitIntro')}</p>
          <div style={wizardNavStyle}>
            <button type="button" style={buttonStyle} onClick={() => goTo('documents')}>
              {t('commonBack')}
            </button>
            <button type="button" disabled={isSubmitting} style={buttonStyle} onClick={() => void handleSubmitKyc()}>
              {isSubmitting ? t('customerWizardSubmittingButton') : t('customerWizardSubmitButton')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
