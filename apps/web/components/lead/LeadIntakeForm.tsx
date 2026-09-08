'use client';

import { useState, type FormEvent } from 'react';
import {
  createLead,
  LEAD_SOURCES,
  type Lead,
  type LeadSource,
} from '../../lib/lead/lead-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { buttonStyle, errorStyle, inputStyle, labelStyle, successStyle } from '../auth/auth-form.styles';
import { checkboxRowStyle, fieldStyle, formRowStyle, sectionStyle } from './lead.styles';
import { PrivacyNoticeDisplay, NOTICE_READ_ROLES } from '../pdpl/PrivacyNoticeDisplay';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';

const SOURCE_LABEL_KEY: Record<LeadSource, TranslationKey> = {
  referral: 'leadSourceReferral',
  website: 'leadSourceWebsite',
  social_media: 'leadSourceSocialMedia',
  campaign: 'leadSourceCampaign',
  tender: 'leadSourceTender',
  bank_partner: 'leadSourceBankPartner',
  strategic_partner: 'leadSourceStrategicPartner',
  ex_customer: 'leadSourceExCustomer',
  renewal: 'leadSourceRenewal',
};

interface LeadIntakeFormProps {
  onLeadCreated: (lead: Lead) => void;
}

export function LeadIntakeForm({ onLeadCreated }: LeadIntakeFormProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [fullName, setFullName] = useState('');
  const [source, setSource] = useState<LeadSource>('referral');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  // Marketing consent is unticked by default and captured distinctly from
  // KYC consent (Part 6.3) — never pre-check this box.
  const [marketingConsentGranted, setMarketingConsentGranted] = useState(false);
  // Part D §5.1 — which approved privacy-notice wording was shown at
  // intake (`PRIV-FRM-04/05`). Pre-filled with the current default so this
  // checkbox stays low-friction for the common case, but stays editable —
  // the same free-text-with-a-default shape every other touchpoint's
  // consent-text-version field uses.
  const [consentTextVersion, setConsentTextVersion] = useState('privacy-notice-v1.2');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);
    try {
      const lead = await createLead({
        fullName,
        source,
        contactPhone: contactPhone || undefined,
        contactEmail: contactEmail || undefined,
        marketingConsentGranted,
        consentTextVersion,
      });
      setMessage(t('leadsAddedMessage', { name: lead.fullName }));
      setFullName('');
      setSource('referral');
      setContactPhone('');
      setContactEmail('');
      setMarketingConsentGranted(false);
      setConsentTextVersion('privacy-notice-v1.2');
      onLeadCreated(lead);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('leadsCreateError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>{t('leadsNewLeadHeading')}</h2>
      <PrivacyNoticeDisplay
        touchpoint="lead_capture"
        canRead={!!user && user.roles.some((r) => NOTICE_READ_ROLES.includes(r))}
      />
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="lead-full-name" style={labelStyle}>
              {t('leadsFullNameLabel')}
            </label>
            <input
              id="lead-full-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={inputStyle}
              dir="auto"
              placeholder={t('leadsFullNamePlaceholder')}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="lead-source" style={labelStyle}>
              {t('leadsSourceLabel')}
            </label>
            <select
              id="lead-source"
              value={source}
              onChange={(e) => setSource(e.target.value as LeadSource)}
              style={inputStyle}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(SOURCE_LABEL_KEY[s])}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="lead-phone" style={labelStyle}>
              {t('leadsPhoneLabel')}
            </label>
            <input
              id="lead-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              style={inputStyle}
              placeholder="+962-7-..."
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="lead-email" style={labelStyle}>
              {t('leadsEmailLabel')}
            </label>
            <input
              id="lead-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={checkboxRowStyle}>
          <input
            id="lead-marketing-consent"
            type="checkbox"
            checked={marketingConsentGranted}
            onChange={(e) => setMarketingConsentGranted(e.target.checked)}
          />
          <label htmlFor="lead-marketing-consent">{t('leadsMarketingConsentLabel')}</label>
        </div>
        <div style={fieldStyle}>
          <label htmlFor="lead-consent-text-version" style={labelStyle}>
            {t('leadsConsentTextVersionLabel')}
          </label>
          <input
            id="lead-consent-text-version"
            required
            value={consentTextVersion}
            onChange={(e) => setConsentTextVersion(e.target.value)}
            style={inputStyle}
            placeholder="e.g. privacy-notice-v1.2"
          />
        </div>
        <button type="submit" disabled={isSubmitting} style={buttonStyle}>
          {isSubmitting ? t('leadsAddingButton') : t('leadsAddButton')}
        </button>
        {message ? <p style={successStyle}>{message}</p> : null}
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
