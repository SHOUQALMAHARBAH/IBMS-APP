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
 * review queue. So `screeningFlagged` is reported apart from `rejected`, and worded as work to
 * review. Folding it in with the refusals would teach an office to treat a real hit as a data
 * problem.
 *
 * (This paragraph said "`rejected` and `failures`" until 2026-10-23. `failures` had not existed on
 * the api since Phase 2 item 1 replaced it, which is the same drift that made the result panel throw
 * — see the comment on that panel.)
 *
 * ## The durable report is on this screen now
 *
 * `GET /imports/customers/batches` and `.../batches/:id` were built with no reader and recorded as a
 * defect: an officer who imported 2,000 rows read its refusals once. The register at the bottom is
 * what makes them readable tomorrow, which is the whole reason `LegacyImportBatch` exists.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, isMfaEnrolmentError } from '../../../../lib/auth/api-client';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, sectionStyle } from '../../../../components/lead/lead.styles';
import {
  getImportBatch,
  importCustomers,
  listImportBatches,
  IMPORT_FIELDS,
  IMPORT_REQUIRED_FIELDS,
  type ImportBatch,
  type ImportField,
  type ImportIssue,
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

/**
 * THE WORD FOR EACH ISSUE KIND — and TWO OF THE THREE HAVE NO WORD YET, declared rather than
 * invented.
 *
 * Nothing in the whole i18n tree contains an Arabic word for *duplicate*, so there was nothing to
 * derive `DUPLICATE` or `BAD_DATA` from, and writing one is what the eighteen-workflow-words
 * procedure forbids. Those two render their MEMBER NAME, which is the same decision and the same
 * mechanism: an English member name is visibly unfinished, where a plausible invented word is
 * indistinguishable from a decided one and would never be corrected.
 *
 * ON THIS PARTICULAR TABLE IT IS LESS JARRING THAN ELSEWHERE, and that is a fact rather than an
 * excuse: the `detail` rendered beside the kind is the SERVER's own sentence, which is English
 * because this api has no message i18n at all — a recorded gap. So the row is already
 * mixed-language by necessity, and the kind is strictly more informative than a blank.
 *
 * `Partial<Record<...>>` as the declared type with `satisfies` over the union: adding a fourth kind
 * is a build error until it is named, while the lookup stays honest about a key being absent.
 */
const ISSUE_KIND_LABEL: Partial<Record<ImportIssue['kind'], TranslationKey>> = {
  IMPORTED_NEEDS_REVIEW: 'impIssueKindNeedsReview',
} satisfies Partial<Record<ImportIssue['kind'], TranslationKey>>;

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
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  /** Which past import is expanded, and its lines once they have arrived. */
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [openIssues, setOpenIssues] = useState<ImportIssue[] | null>(null);

  const kindLabel = (kind: ImportIssue['kind']): string => {
    const key = ISSUE_KIND_LABEL[kind];
    return key ? t(key) : kind;
  };

  /*
   * THE DURABLE REPORT, LOADED ON MOUNT. Gated by nothing of its own: the whole screen is behind
   * `customer.bulk-import` and so is the route, which is the api's own argument — whoever may run an
   * import may read what theirs did, and nobody else has any use for it. So there is no permission
   * branch here and no refusal sentence; the one at the top of the screen already covers it.
   */
  const loadBatches = useCallback(async () => {
    try {
      setBatches(await listImportBatches());
      setBatchesError(null);
    } catch (err) {
      setBatches(null);
      setBatchesError(
        err instanceof ApiError ? err.message : t('impPastLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!canImport) return;
    void (async () => {
      await loadBatches();
    })();
  }, [canImport, loadBatches]);

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
      // The import just wrote a batch, so the register below is stale the moment the panel appears.
      await loadBatches();
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

          {/*
            THE CRASH THIS REPLACES. This read `result.rejections.length +
            result.failures.length`, and Phase 2 item 1 had replaced both of those with one `issues`
            list carrying a `kind` — so both were `undefined`, and the panel threw during render on
            EVERY SUCCESSFUL IMPORT. The rows went in; the report on them died.

            Nothing caught it for three weeks and the reasons are both worth keeping. TypeScript
            cannot check an interface a screen declares by hand over an HTTP response. And the
            Playwright fixture SUPPLIED THE OLD FIELDS ITSELF, so the suite was green against a
            shape the server had stopped sending — a mock cannot drop a field the api dropped.
            `packages/db/prisma/legacy-import-shape-parity.spec.ts` is the answer to both: it is the
            only place that can read the api's declaration and this one together.
          */}
          {result.issues.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'start' }}>{t('impColLine')}</th>
                    <th style={{ textAlign: 'start' }}>{t('impColReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ONE table for all three kinds, because to the person fixing the file they are
                      the same sitting — but the KIND leads each reason, because a duplicate needs an
                      identity decision and bad data needs a typo fixed, and the api's own comment
                      says that distinction decays the moment it becomes prose. Each row keeps the
                      line number the office sees in their own spreadsheet, which is why the API
                      counts the header as line 1. */}
                  {result.issues.map((row, i) => (
                    <tr
                      key={`${row.lineNumber}-${i}`}
                      data-import-issue={row.lineNumber}
                      data-import-issue-kind={row.kind}
                    >
                      <td>{row.lineNumber}</td>
                      <td>
                        {kindLabel(row.kind)} — {row.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/*
        THE DURABLE REPORT — owner decision 43, and recorded as a defect on 2026-10-02: *"DEFECT 2:
        THE DURABLE REPORT HAS NO SCREEN"*. `batchId`, both batch routes and the
        DUPLICATE-versus-BAD_DATA split all worked, were proven over real HTTP, and nothing reachable
        by clicking read any of them. So an officer who imported 2,000 rows read its refusals ONCE —
        in a panel that then threw.

        Each past import renders the SAME two sentences the office was shown on the day, which is a
        derivation rather than a shortcut: `impResultCounts` and the two screening sentences already
        exist, already say exactly this, and reusing them means a reader cannot be told two different
        things about one import. The file name is the BUTTON that opens the lines — no new label, and
        the counts beside it are the affordance that says there is something to open.
      */}
      <section style={sectionStyle} data-testid="import-register">
        <h2>{t('impPastHeading')}</h2>
        {batchesError !== null ? (
          <p role="alert" style={errorStyle} data-testid="import-register-error">
            {batchesError}
          </p>
        ) : batches === null ? (
          <p>{t('impLoading')}</p>
        ) : batches.length === 0 ? (
          <p
            data-testid="import-register-none"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {t('impPastNone')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {batches.map((b) => (
              <li
                key={b.id}
                data-import-batch={b.fileName}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  padding: '0.6rem 0',
                }}
              >
                <button
                  type="button"
                  aria-expanded={openBatch === b.id}
                  data-testid={`import-batch-open-${b.fileName}`}
                  onClick={() => {
                    if (openBatch === b.id) {
                      setOpenBatch(null);
                      setOpenIssues(null);
                      return;
                    }
                    setOpenBatch(b.id);
                    setOpenIssues(null);
                    void (async () => {
                      try {
                        const full = await getImportBatch(b.id);
                        setOpenIssues(full.issues);
                      } catch (err) {
                        setBatchesError(
                          err instanceof ApiError
                            ? err.message
                            : t('impPastLoadError'),
                        );
                      }
                    })();
                  }}
                >
                  {b.fileName}
                </button>{' '}
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {b.startedAt.slice(0, 10)}
                </span>
                {/* THE SAME SENTENCES THE OFFICE SAW ON THE DAY. `refused` is the batch row's own
                    column name for what the import response calls `rejected`. */}
                <p style={{ margin: '0.25rem 0 0' }}>
                  {t('impResultCounts', {
                    imported: String(b.imported),
                    total: String(b.totalDataRows),
                    rejected: String(b.refused),
                  })}
                </p>
                <p style={{ margin: 0, color: 'var(--ink-secondary)' }}>
                  {b.needsReview === 0
                    ? t('impScreeningClear', { screened: String(b.screened) })
                    : t('impScreeningFlagged', {
                        screened: String(b.screened),
                        flagged: String(b.needsReview),
                      })}
                </p>
                {openBatch === b.id ? (
                  openIssues === null ? (
                    <p>{t('impLoading')}</p>
                  ) : openIssues.length === 0 ? (
                    <p style={{ color: 'var(--ink-secondary)' }}>
                      {t('impScreeningClear', { screened: String(b.screened) })}
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        data-testid={`import-batch-issues-${b.fileName}`}
                        style={{ width: '100%', borderCollapse: 'collapse' }}
                      >
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'start' }}>
                              {t('impColLine')}
                            </th>
                            <th style={{ textAlign: 'start' }}>
                              {t('impColReason')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {openIssues.map((row, i) => (
                            <tr
                              key={`${row.lineNumber}-${i}`}
                              data-import-issue={row.lineNumber}
                              data-import-issue-kind={row.kind}
                            >
                              <td>{row.lineNumber}</td>
                              <td>
                                {kindLabel(row.kind)} — {row.detail}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
