'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  addCustomerDocument,
  addUbo,
  createCustomer,
  type Customer,
  type CustomerDocument,
  type CustomerType,
  type DocumentClassification,
  type LanguagePreference,
  type Ubo,
} from '../../lib/customer/customer-api';
import { startKyc, submitKyc, type KycRecord } from '../../lib/kyc/kyc-api';
import { ApiError } from '../../lib/auth/api-client';
import { assertNoPresetSensitiveDefaults } from '../../lib/forms/privacy-by-default';
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

const STEP_LABEL: Record<Step, string> = {
  type: 'Customer type',
  profile: 'Profile',
  ubos: 'Beneficial owners',
  documents: 'Documents',
  review: 'Review & submit',
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
  // SENSITIVE_FIELD_NAMES above).
  const [legalName, setLegalName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [natureOfBusiness, setNatureOfBusiness] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('AR');

  // UBO mini-form
  const [uboFullName, setUboFullName] = useState('');
  const [uboNationalId, setUboNationalId] = useState('');
  const [uboOwnershipPercent, setUboOwnershipPercent] = useState('');
  const [uboIsPep, setUboIsPep] = useState(false);

  // Document mini-form
  const [docFileName, setDocFileName] = useState('');
  const [docStorageRef, setDocStorageRef] = useState('');
  const [docClassification, setDocClassification] = useState<DocumentClassification>('CONFIDENTIAL');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function goTo(target: Step) {
    const idx = steps.indexOf(target);
    if (idx >= 0) setStepIndex(idx);
  }

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (!customerType) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const createdCustomer = await createCustomer({
        customerType,
        legalName,
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
      goTo(customerType === 'CORPORATE' ? 'ubos' : 'documents');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the customer — try again.');
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
        fullName: uboFullName,
        nationalId: uboNationalId,
        ownershipPercent: uboOwnershipPercent ? Number(uboOwnershipPercent) : undefined,
        isPep: uboIsPep,
      });
      setUbos((prev) => [...prev, ubo]);
      setUboFullName('');
      setUboNationalId('');
      setUboOwnershipPercent('');
      setUboIsPep(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this beneficial owner — try again.');
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
      setError(err instanceof ApiError ? err.message : 'Could not attach this document — try again.');
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
      setError(err instanceof ApiError ? err.message : 'Could not submit this KYC file — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <div style={stepIndicatorStyle}>
        {steps.map((s, i) => (
          <span key={s} style={stepPillStyle(i === stepIndex, i < stepIndex)}>
            {i + 1}. {STEP_LABEL[s]}
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
          <h2 style={{ marginTop: 0 }}>Is this an individual or corporate customer?</h2>
          <div style={{ ...formRowStyle, marginTop: '1rem' }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setCustomerType('INDIVIDUAL');
                setStepIndex(1);
              }}
            >
              Individual
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setCustomerType('CORPORATE');
                setStepIndex(1);
              }}
            >
              Corporate
            </button>
          </div>
        </div>
      ) : null}

      {step === 'profile' ? (
        <form onSubmit={(e) => void handleProfileSubmit(e)}>
          <h2 style={{ marginTop: 0 }}>
            {customerType === 'CORPORATE' ? 'Corporate profile' : 'Individual profile'}
          </h2>
          <div style={formRowStyle}>
            <div style={fieldStyle}>
              <label htmlFor="cust-legal-name" style={labelStyle}>
                {customerType === 'CORPORATE' ? 'Legal (registered) name' : 'Full name'}
              </label>
              <input
                id="cust-legal-name"
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                style={inputStyle}
              />
            </div>
            {customerType === 'INDIVIDUAL' ? (
              <div style={fieldStyle}>
                <label htmlFor="cust-national-id" style={labelStyle}>
                  National ID
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
                  Commercial registration number
                </label>
                <input
                  id="cust-registration-number"
                  required
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
                  Registered address
                </label>
                <input
                  id="cust-address"
                  required
                  value={registeredAddress}
                  onChange={(e) => setRegisteredAddress(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="cust-nature" style={labelStyle}>
                  Nature of business
                </label>
                <input
                  id="cust-nature"
                  required
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
                Tax registration number (optional)
              </label>
              <input
                id="cust-tax-reg"
                value={taxRegistrationNumber}
                onChange={(e) => setTaxRegistrationNumber(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={fieldStyle}>
              <label htmlFor="cust-language" style={labelStyle}>
                Language preference
              </label>
              <select
                id="cust-language"
                value={languagePreference}
                onChange={(e) => setLanguagePreference(e.target.value as LanguagePreference)}
                style={inputStyle}
              >
                <option value="AR">Arabic</option>
                <option value="EN">English</option>
              </select>
            </div>
          </div>

          <div style={formRowStyle}>
            <div style={fieldStyle}>
              <label htmlFor="cust-phone" style={labelStyle}>
                Contact phone
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
                Contact email
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

          <button type="submit" disabled={isSubmitting} style={buttonStyle}>
            {isSubmitting ? 'Creating…' : 'Create customer & start KYC'}
          </button>
        </form>
      ) : null}

      {step === 'ubos' && customer ? (
        <div>
          <h2 style={{ marginTop: 0 }}>Ultimate Beneficial Owners</h2>
          <p style={{ opacity: 0.8 }}>
            Record every individual with significant ownership or control of {customer.legalName}.
          </p>
          {ubos.map((u) => (
            <div key={u.id} style={repeatableRowStyle}>
              <strong>{u.fullName}</strong>
              {u.ownershipPercent ? <span> — {u.ownershipPercent}%</span> : null}
              {u.isPep ? <span> — PEP</span> : null}
            </div>
          ))}
          <form onSubmit={(e) => void handleAddUbo(e)} style={repeatableRowStyle}>
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="ubo-full-name" style={labelStyle}>
                  Full name
                </label>
                <input
                  id="ubo-full-name"
                  required
                  value={uboFullName}
                  onChange={(e) => setUboFullName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor="ubo-national-id" style={labelStyle}>
                  National ID
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
                  Ownership %
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
                Politically Exposed Person (PEP)
              </label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ ...buttonStyle, width: 'auto' }}>
              Add owner
            </button>
          </form>
          <div style={wizardNavStyle}>
            <button type="button" style={buttonStyle} onClick={() => goTo('documents')}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'documents' && customer ? (
        <div>
          <h2 style={{ marginTop: 0 }}>Supporting documents</h2>
          <p style={{ opacity: 0.8 }}>
            Application/proposal documents for {customer.legalName}&apos;s KYC file. No file-upload
            storage exists yet — record the document reference/filename.
          </p>
          {documents.map((d) => (
            <div key={d.id} style={repeatableRowStyle}>
              <strong>{d.fileName}</strong> — {d.classification}
            </div>
          ))}
          <form onSubmit={(e) => void handleAddDocument(e)} style={repeatableRowStyle}>
            <div style={formRowStyle}>
              <div style={fieldStyle}>
                <label htmlFor="doc-file-name" style={labelStyle}>
                  File name / reference
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
                  Storage reference
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
                  Classification
                </label>
                <select
                  id="doc-classification"
                  value={docClassification}
                  onChange={(e) => setDocClassification(e.target.value as DocumentClassification)}
                  style={inputStyle}
                >
                  <option value="CONFIDENTIAL">Confidential</option>
                  <option value="HIGHLY_CONFIDENTIAL">Highly confidential (e.g. ID scan)</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ ...buttonStyle, width: 'auto' }}>
              Attach document
            </button>
          </form>
          <div style={wizardNavStyle}>
            {customerType === 'CORPORATE' ? (
              <button type="button" style={buttonStyle} onClick={() => goTo('ubos')}>
                Back
              </button>
            ) : null}
            <button type="button" style={buttonStyle} onClick={() => goTo('review')}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' && customer && kyc ? (
        <div>
          <h2 style={{ marginTop: 0 }}>Review & submit</h2>
          {/* Render the values the officer actually typed on the profile
              step (still in local state) — NOT the create() response, whose
              contactPhone/contactEmail come back masked, so a typo in the
              contact fields would be impossible to catch here. These stay
              client-side only; nothing is logged. */}
          <ul>
            <li>
              <strong>{legalName}</strong> ({customer.customerType})
            </li>
            <li>Contact: {contactPhone} / {contactEmail}</li>
            {customerType === 'CORPORATE' ? <li>Beneficial owners recorded: {ubos.length}</li> : null}
            <li>Documents attached: {documents.length}</li>
          </ul>
          <p style={{ opacity: 0.8 }}>
            Submitting hands this KYC file to Compliance for sanctions/PEP/AML screening and
            approval — the Customer stays PENDING_KYC until it&apos;s approved.
          </p>
          <div style={wizardNavStyle}>
            <button type="button" style={buttonStyle} onClick={() => goTo('documents')}>
              Back
            </button>
            <button type="button" disabled={isSubmitting} style={buttonStyle} onClick={() => void handleSubmitKyc()}>
              {isSubmitting ? 'Submitting…' : 'Submit for compliance review'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
