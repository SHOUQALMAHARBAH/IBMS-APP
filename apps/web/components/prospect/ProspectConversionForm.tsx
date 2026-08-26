'use client';

import { useState, type FormEvent } from 'react';
import { convertLeadToProspect, type Prospect } from '../../lib/prospect/prospect-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../auth/auth-form.styles';
import { fieldStyle, formRowStyle, sectionStyle } from '../lead/lead.styles';

interface ProspectConversionFormProps {
  leadId: string;
  defaultCompanyName?: string;
  onProspectCreated: (prospect: Prospect) => void;
}

/** Splits a free-text "Medical, Motor, Property" field into the string[]
 * Prospect.productsOfInterest expects — the backend deliberately leaves this
 * as free-form lines (see create-prospect.dto.ts), not a closed picklist. */
function parseProductsOfInterest(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ProspectConversionForm({
  leadId,
  defaultCompanyName,
  onProspectCreated,
}: ProspectConversionFormProps) {
  const [companyName, setCompanyName] = useState(defaultCompanyName ?? '');
  const [sector, setSector] = useState('');
  const [activity, setActivity] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [businessSize, setBusinessSize] = useState('');
  const [location, setLocation] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [productsOfInterest, setProductsOfInterest] = useState('');
  const [expectedPremium, setExpectedPremium] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const prospect = await convertLeadToProspect({
        leadId,
        companyName,
        sector: sector || undefined,
        activity: activity || undefined,
        employeeCount: employeeCount ? Number(employeeCount) : undefined,
        businessSize: businessSize || undefined,
        location: location || undefined,
        contactPerson: contactPerson || undefined,
        productsOfInterest: productsOfInterest
          ? parseProductsOfInterest(productsOfInterest)
          : undefined,
        expectedPremium: expectedPremium || undefined,
      });
      onProspectCreated(prospect);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not convert this lead to a prospect — try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>Qualification details</h2>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="prospect-company-name" style={labelStyle}>
              Company name
            </label>
            <input
              id="prospect-company-name"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="prospect-sector" style={labelStyle}>
              Sector (optional)
            </label>
            <input
              id="prospect-sector"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Manufacturing"
            />
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="prospect-activity" style={labelStyle}>
              Activity (optional)
            </label>
            <input
              id="prospect-activity"
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="prospect-employee-count" style={labelStyle}>
              Employee count (optional)
            </label>
            <input
              id="prospect-employee-count"
              type="number"
              min={0}
              value={employeeCount}
              onChange={(e) => setEmployeeCount(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="prospect-business-size" style={labelStyle}>
              Business size (optional)
            </label>
            <input
              id="prospect-business-size"
              value={businessSize}
              onChange={(e) => setBusinessSize(e.target.value)}
              style={inputStyle}
              placeholder="e.g. SME, Corporate"
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="prospect-location" style={labelStyle}>
              Location (optional)
            </label>
            <input
              id="prospect-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={fieldStyle}>
            <label htmlFor="prospect-contact-person" style={labelStyle}>
              Contact person (optional)
            </label>
            <input
              id="prospect-contact-person"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="prospect-expected-premium" style={labelStyle}>
              Expected premium, JOD (optional)
            </label>
            <input
              id="prospect-expected-premium"
              inputMode="decimal"
              value={expectedPremium}
              onChange={(e) => setExpectedPremium(e.target.value)}
              style={inputStyle}
              placeholder="e.g. 1250.500"
            />
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={{ ...fieldStyle, flexBasis: '100%' }}>
            <label htmlFor="prospect-products" style={labelStyle}>
              Products of interest (optional, comma-separated)
            </label>
            <input
              id="prospect-products"
              value={productsOfInterest}
              onChange={(e) => setProductsOfInterest(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Medical, Motor, Property"
            />
          </div>
        </div>
        <button type="submit" disabled={isSubmitting} style={buttonStyle}>
          {isSubmitting ? 'Converting…' : 'Convert to prospect'}
        </button>
        {error ? (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
