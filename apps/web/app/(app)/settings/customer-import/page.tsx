'use client';

/*
 * Load an office's legacy customer file — `POST /imports/customers`, which had no web caller.
 *
 * ## Why its own screen under Settings rather than a section on /customers
 *
 * § 1.61, measured: `customer.bulk-import` is held by OFFICE_ADMINISTRATOR and
 * SYSTEM_SECURITY_ADMINISTRATOR, and NEITHER holds `customer.create` — nor, for the administrator,
 * any code that reads a customer at all. So a section on `/customers` would sit on a screen its
 * only two permission-holders cannot use. Both are administrator roles, so the screen lives where
 * they already work.
 *
 * That asymmetry is itself recorded (§ 1.74): the roles that may import five hundred customers
 * cannot create one by hand, and cannot then read what they imported. Defensible as
 * segregation — a migration tool is not a data-entry path — but it is a decision, not something to
 * discover.
 *
 * ## The screening count is not an error count
 *
 * Every imported row is screened through the SAME `ScreeningService.run` the intake flow uses, and
 * a potential match does not stop the import — the row is written and the match joins the sanctions
 * review queue. So `screeningFlagged` is reported apart from `rejected` and `failures`, and worded
 * as work to review. Folding it in with the failures would teach an office to treat a real hit as
 * a data problem.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, isMfaEnrolmentError } from '../../../../lib/auth/api-client';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, sectionStyle } from '../../../../components/lead/lead.styles';
import {
  importCustomers,
  IMPORT_FIELDS,
  IMPORT_REQUIRED_FIELDS,
  type ImportField,
  type ImportResult,
} from '../../../../lib/customer/legacy-import-api';
import type { TranslationKey } from '../../../../lib/i18n/translations';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';

/**
 * A TOTAL map from field to label key.
 *
 * `satisfies` rather than a concatenated `t(\`impField_${field}\`)`: § 1.45 is the case where an
 * `as never` on exactly that shape hid a label missing from BOTH dictionaries, and the raw key
 * rendered on screen. Adding a field to the importer is now a build error until it is named in
 * both languages.
 */
const FIELD_LABEL = {
  legalName: 'impFieldLegalName',
  customerType: 'impFieldCustomerType',
  registrationNumber: 'impFieldRegistrationNumber',
  nationality: 'impFieldNationality',
  contactEmail: 'impFieldContactEmail',
  contactPhone: 'impFieldContactPhone',
  registeredAddress: 'impFieldRegisteredAddress',
} satisfies Record<ImportField, TranslationKey>;

export default function CustomerImportPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canImport = !!user && hasPermission(user, 'customer.bulk-import');

  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>(
    {},
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Every required field must name a column. The server refuses otherwise, naming the field — this
  // just says so before the upload rather than after it.
  const missingRequired = IMPORT_REQUIRED_FIELDS.filter(
    (field) => (mapping[field] ?? '').trim() === '',
  );

  async function submit() {
    if (file === null) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const trimmed: Partial<Record<ImportField, string>> = {};
      for (const field of IMPORT_FIELDS) {
        const heading = (mapping[field] ?? '').trim();
        // An unmapped field must be ABSENT from the mapping, never ''. An empty heading would
        // instruct the server to look for a column named "", which is a different request from
        // "this file does not carry that field".
        if (heading !== '') trimmed[field] = heading;
      }
      setResult(await importCustomers(file, trimmed));
    } catch (err) {
      if (err instanceof ApiError && isMfaEnrolmentError(err)) {
        router.push('/settings/security');
        return;
      }
      setError(err instanceof ApiError ? err.message : t('impFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <main style={pageStyle}>{t('impLoading')}</main>;

  if (!canImport) {
    return (
      <main style={pageStyle}>
        <h1>{t('impHeading')}</h1>
        <p role="alert" style={errorStyle}>
          {permissionRefusal(t, 'impRefusalAct', 'customer.bulk-import')}
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>{t('impHeading')}</h1>
      <p style={{ color: 'var(--ink-secondary)', maxWidth: '50rem' }}>
        {t('impIntro')}
      </p>

      <form
        style={sectionStyle}
        data-testid="customer-import-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset>
          <legend>{t('impUploadLegend')}</legend>

          <label>
            {t('impFileLabel')}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              data-testid="import-file"
            />
          </label>

          <p style={{ fontSize: '0.85rem', color: 'var(--ink-secondary)' }}>
            {t('impMappingIntro')}
          </p>

          {IMPORT_FIELDS.map((field) => (
            <label key={field}>
              {t(FIELD_LABEL[field])}
              {IMPORT_REQUIRED_FIELDS.includes(field) ? ' *' : ''}
              <input
                value={mapping[field] ?? ''}
                onChange={(e) =>
                  setMapping((prev) => ({ ...prev, [field]: e.target.value }))
                }
                data-testid={`import-map-${field}`}
              />
            </label>
          ))}

          {missingRequired.length > 0 && (
            <p
              style={{ fontSize: '0.85rem', color: 'var(--ink-secondary)' }}
              data-testid="import-missing-required"
            >
              {t('impMissingRequired', {
                fields: missingRequired
                  .map((field) => t(FIELD_LABEL[field]))
                  .join(', '),
              })}
            </p>
          )}

          {error !== null && (
            <p role="alert" style={errorStyle}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || file === null || missingRequired.length > 0}
            data-testid="import-submit"
          >
            {busy ? t('impImporting') : t('impSubmit')}
          </button>
        </fieldset>
      </form>

      {result !== null && (
        <section style={sectionStyle} data-testid="import-result">
          <h2>{t('impResultHeading', { fileName: result.fileName })}</h2>
          <p data-testid="import-counts">
            {t('impResultCounts', {
              imported: String(result.imported),
              total: String(result.totalDataRows),
              rejected: String(result.rejected),
            })}
          </p>

          {/* Reported APART from the rejections, and as work rather than as an error: the row was
              imported and its match is in the sanctions queue. */}
          <p data-testid="import-screening">
            {result.screeningFlagged === 0
              ? t('impScreeningClear', { screened: String(result.screened) })
              : t('impScreeningFlagged', {
                  screened: String(result.screened),
                  flagged: String(result.screeningFlagged),
                })}
          </p>

          {result.rejections.length + result.failures.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'start' }}>{t('impColLine')}</th>
                    <th style={{ textAlign: 'start' }}>{t('impColReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Rejections and failures in ONE table, because to the person fixing the file
                      they are the same job — but each row keeps the line number the office will
                      see in their own spreadsheet, which is why the API counts the header as
                      line 1. */}
                  {[...result.rejections, ...result.failures].map((row, i) => (
                    <tr key={`${row.lineNumber}-${i}`} data-import-reject={row.lineNumber}>
                      <td>{row.lineNumber}</td>
                      <td>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
