'use client';

import { useState, type FormEvent } from 'react';
import {
  createLead,
  LEAD_SOURCES,
  type Lead,
  type LeadSource,
} from '../../lib/lead/lead-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle, successStyle } from '../auth/auth-form.styles';
import { checkboxRowStyle, fieldStyle, formRowStyle, sectionStyle } from './lead.styles';

const SOURCE_LABEL: Record<LeadSource, string> = {
  referral: 'Referral',
  website: 'Website',
  social_media: 'Social media',
  campaign: 'Campaign',
  tender: 'Tender',
  bank_partner: 'Bank partner',
  strategic_partner: 'Strategic partner',
  ex_customer: 'Ex-customer',
  renewal: 'Renewal opportunity',
};

interface LeadIntakeFormProps {
  onLeadCreated: (lead: Lead) => void;
}

export function LeadIntakeForm({ onLeadCreated }: LeadIntakeFormProps) {
  const [fullName, setFullName] = useState('');
  const [source, setSource] = useState<LeadSource>('referral');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  // Marketing consent is unticked by default and captured distinctly from
  // KYC consent (Part 6.3) — never pre-check this box.
  const [marketingConsentGranted, setMarketingConsentGranted] = useState(false);
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
      });
      setMessage(`Lead "${lead.fullName}" added to your pipeline.`);
      setFullName('');
      setSource('referral');
      setContactPhone('');
      setContactEmail('');
      setMarketingConsentGranted(false);
      onLeadCreated(lead);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the lead — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>New lead</h2>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="lead-full-name" style={labelStyle}>
              Full name
            </label>
            <input
              id="lead-full-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Ahmad Al-Fulani"
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="lead-source" style={labelStyle}>
              Source
            </label>
            <select
              id="lead-source"
              value={source}
              onChange={(e) => setSource(e.target.value as LeadSource)}
              style={inputStyle}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="lead-phone" style={labelStyle}>
              Contact phone (optional)
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
              Contact email (optional)
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
          <label htmlFor="lead-marketing-consent">
            This lead has agreed to receive marketing communications
          </label>
        </div>
        <button type="submit" disabled={isSubmitting} style={buttonStyle}>
          {isSubmitting ? 'Adding…' : 'Add lead'}
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
