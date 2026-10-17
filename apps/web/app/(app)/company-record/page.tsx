'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { useLanguage } from '../../../lib/i18n/language-context';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import {
  fetchOwnRecord,
  type CompanyRecord,
  type NamedRow,
} from '../../../lib/company/company-record-api';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — an insurance company's own registry record.
 *
 * ## READ-ONLY, AND IT SAYS SO BEFORE THE FIRST FIELD
 *
 * There is no form, no save and no client function for one. A company's registry record is what the
 * PROVIDER filed, and a company editing it here would make two sources of truth for a fact a
 * regulator reads. The intro states that correcting anything goes through the operator, because a
 * read-only screen that does not say why reads as a screen whose buttons are missing.
 *
 * ## THE 403 IS NOT A PERMISSION REFUSAL, SO IT DOES NOT USE `permissionRefusal`
 *
 * This route has no permission code — it asks whether the caller IS the company whose record it
 * shows, which is identity rather than capability (see `company-record.controller.ts`). So the
 * refusal names the ORGANIZATION TYPE and points a brokerage reader at their own licence screen,
 * rather than telling them to ask for a grant that does not exist. A refusal that sends somebody to
 * request a non-existent permission is worse than a bare 403.
 *
 * ## RECORD STATE SAYS WHAT WE HOLD AND MAKES NO FINDING ABOUT THE COMPANY
 *
 * Decision 88's rule four, written for the office registration pack and applying here unchanged. A
 * company licensed by the Central Bank already filed its certificate with the regulator, so our not
 * holding a copy is OUR gap. And "recorded" means the document's name, location and filer are
 * recorded — never that the file can be fetched, because this product has no object storage.
 */

const sectionStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1.25rem',
};
const legendStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: '1rem',
  marginBottom: '0.75rem',
};
const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(12rem, 18rem) 1fr',
  gap: '0.5rem 1rem',
  padding: '0.3rem 0',
};
const labelStyle: CSSProperties = { color: 'var(--ink-muted)' };
const noteStyle: CSSProperties = {
  color: 'var(--ink-muted)',
  fontSize: '0.9rem',
  lineHeight: 1.6,
  marginTop: '0.75rem',
};
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const thStyle: CSSProperties = {
  textAlign: 'start',
  borderBottom: '1px solid var(--border)',
  padding: '0.4rem 0.5rem',
};
const tdStyle: CSSProperties = {
  borderBottom: '1px solid var(--border)',
  padding: '0.4rem 0.5rem',
};

export default function CompanyRecordPage() {
  const { t, language } = useLanguage();
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [record, setRecord] = useState<CompanyRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setRecord(await fetchOwnRecord());
      setLoadError(null);
    } catch (err) {
      setRecord(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('companyRecordRefusal')
          : t('companyRecordLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    // The house async-IIFE form. `void load()` inside an effect is a lint ERROR here.
    void (async () => {
      await load();
    })();
  }, [user, load]);

  /** Both names come over the wire and the SCREEN picks, because an Arabic name is nullable and the
   *  caller is the one that knows which language it is rendering — the `DetailPart` rule. */
  const named = (row: NamedRow | null) =>
    row ? (language === 'AR' ? (row.nameAr ?? row.nameEn) : row.nameEn) : null;

  const field = (labelKey: Parameters<typeof t>[0], value: string | null) => (
    <div style={rowStyle} key={String(labelKey)}>
      <span style={labelStyle}>{t(labelKey)}</span>
      {/* An em dash would say "there is no such thing"; this says nobody has entered it, which is a
          different fact and the only one of the two that is actionable. */}
      <span>{value ?? t('companyNotRecorded')}</span>
    </div>
  );

  if (!user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('companyRecordHeading')}</h1>
      <p style={noteStyle}>{t('companyRecordIntro')}</p>

      {loadError && (
        <p role="alert" style={errorStyle} data-testid="company-record-error">
          {loadError}
        </p>
      )}

      {!loadError && !record && (
        <p role="status" data-testid="company-record-loading">
          {t('companyRecordLoading')}
        </p>
      )}

      {record && (
        <>
          <section style={sectionStyle} data-testid="company-identity">
            <h2 style={legendStyle}>{t('companySectionIdentity')}</h2>
            {field('companyLegalName', record.identity.legalName)}
            {field('companyLegalNameAr', record.identity.legalNameAr)}
            {field('companyShortName', record.identity.shortName)}
            {field('companyCode', record.identity.code)}
            {field(
              'companyNationalEstablishmentNo',
              record.identity.nationalEstablishmentNo,
            )}
            {field(
              'companyCommercialRegistrationNo',
              record.identity.commercialRegistrationNo,
            )}
            {field('companyTaxNumber', record.identity.taxNumber)}
            {field(
              'companyInsurerLicenseNumber',
              record.identity.insurerLicenseNumber,
            )}
            {field('companyLegalForm', named(record.identity.legalForm))}
            {field(
              'companyLicensingAuthority',
              named(record.identity.licensingAuthority),
            )}
            {field('companyBusinessModel', named(record.identity.businessModel))}
            {field('companyCountry', named(record.identity.country))}
            {field('companyCity', named(record.identity.city))}
            {field('companyAddress', record.identity.address)}
            {field('companyPhone', record.identity.phone)}
            {field('companyEmail', record.identity.email)}
            {field('companyWebsite', record.identity.website)}
            {field('companyQuotationEmail', record.identity.quotationEmail)}
            {field('companyClaimsEmail', record.identity.claimsEmail)}
            {field(
              'companyIntegrationMethod',
              record.identity.integrationMethod,
            )}
            {field(
              'companyRegisteredAt',
              record.identity.registeredAt.slice(0, 10),
            )}
          </section>

          <section style={sectionStyle} data-testid="company-licensed-lines">
            <h2 style={legendStyle}>{t('companySectionLicensedLines')}</h2>
            {record.licensedLines.length === 0 ? (
              <p role="status" style={noteStyle}>
                {t('companyNoLicensedLines')}
              </p>
            ) : (
              <>
                {field(
                  'companyLicensedCategories',
                  record.licensedCategories.join(' · '),
                )}
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t('companyLineCode')}</th>
                      <th style={thStyle}>{t('companyLineName')}</th>
                      <th style={thStyle}>{t('companyLineCategory')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.licensedLines.map((line) => (
                      <tr key={line.code}>
                        <td style={tdStyle}>{line.code}</td>
                        <td style={tdStyle}>{named(line)}</td>
                        <td style={tdStyle}>{line.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <section style={sectionStyle} data-testid="company-certificate">
            <h2 style={legendStyle}>{t('companySectionCertificate')}</h2>
            {record.certificate ? (
              <>
                {field(
                  'companyCertificateFileName',
                  record.certificate.fileName,
                )}
                {field(
                  'companyCertificateRecordedAt',
                  record.certificate.recordedAt.slice(0, 10),
                )}
              </>
            ) : (
              <p role="status" style={noteStyle}>
                {t('companyNoCertificate')}
              </p>
            )}
          </section>

          <section style={sectionStyle} data-testid="company-record-state">
            <h2 style={legendStyle}>{t('companySectionRecordState')}</h2>
            {field(
              'companyCertificateOnRecord',
              record.recordState.certificateOnRecord
                ? t('companyYes')
                : t('companyNo'),
            )}
            {field(
              'companyLicensedLineCount',
              String(record.recordState.licensedLineCount),
            )}
            {/* The clause that may never become a finding about the company. */}
            <p style={noteStyle} data-testid="company-record-state-scope">
              {t('companyRecordStateScope')}
            </p>
          </section>
        </>
      )}
    </main>
  );
}
