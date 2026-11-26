import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentDate,
  formatDocumentMoney,
  preferLanguage,
  type DocumentLanguage,
} from '../document-generation/document-html.util';
import type { CoverageFigureEntry } from './policy.config';

/** Part F item #7 — policy schedule summary, the 4th of the 6 named
 * document types (after complaint acknowledgement, quotation comparison,
 * recommendation report). Derived from `Policy` + its most recent
 * `PolicySchedule` (backlog's own "Derive it from Policy +
 * PolicySchedule" scoping decision, chosen for the certificate type
 * earlier this item and reused here since a schedule summary is
 * literally the same underlying data). The gate is a data-availability
 * one, not a business-workflow one like the recommendation report's
 * `blockedFromSend`: a Policy has no coverage schedule to summarize
 * until Process 19 issuance records the first one (`schedules.length ===
 * 0` before that — see `policy-schedule-summary-document.service.ts`).
 *
 * "Most recent schedule": `PolicyRepository`'s own `POLICY_INCLUDE`
 * already orders `schedules` `effectiveFrom desc`, so `schedules[0]` is
 * both the latest-effective AND (for any policy that still has an open
 * schedule) the currently-open one — closing one and opening a
 * replacement happen together in `versionScheduleForEndorsement`, so
 * there is never an older-but-still-open row ahead of it. A cancelled
 * policy's most recent schedule is its last CLOSED one — this document
 * still renders it (an "as at" historical snapshot), rather than
 * refusing outright, since a client can reasonably want a record of the
 * cover that was in force before cancellation.
 *
 * `limits.` / `sumsInsured.` are free-form JSON objects with NO fixed
 * key vocabulary (`policy.config.ts#assertCoverageFigures` only checks
 * "non-empty flat object of scalar values" — the key names themselves
 * are whatever Placement/Checking staff typed). Unlike
 * `quotation-comparison.template.ts` (which omits `limits` entirely for
 * exactly this reason), this document's whole purpose IS the schedule,
 * so omitting it is not an option — a flagged decision: each key is
 * rendered as literal text (escaped, never translated — there is no
 * bilingual convention for it, the same treatment free-text fields like
 * `Complaint.issue` already get elsewhere), and each value is passed
 * through `formatDocumentMoney` (the schema's own doc comment calls
 * these "the requested/issued coverage snapshot" — monetary by domain
 * convention even though not yet `Decimal`-typed; a non-numeric string
 * value degrades gracefully to `formatDocumentMoney`'s own escaped
 * raw-plus-currency-prefix fallback, not a crash). */

export type { CoverageFigureEntry };

export interface PolicyScheduleSummaryData {
  customerLegalName: string;
  insurerName: string;
  /** The insurer's Arabic name, or null where none is recorded — decision 153 §U2's
   *  ruling applied to the second of the five outward documents. Read from the SAME
   *  source as `insurerName` by `resolveInsurerNamePair`, never coalesced field by
   *  field; `preferLanguage` falls back to the Latin name one way only. */
  insurerNameAr: string | null;
  policyNumber: string | null;
  insuranceLine: string;
  /** The line's Arabic name from the catalogue join the policy already carries, or
   *  null where none is known — `insurance-line-names.ts` is the one resolver. */
  insuranceLineAr: string | null;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  requestedPremium: { toString(): string };
  issuedPremium: { toString(): string } | null;
  /** The signed issued-minus-requested delta, already fils-quantized —
   * `policy.config.ts#premiumVariance()`'s own output, reused as-is
   * rather than recomputed here. */
  premiumVariance: string | null;
  currency: string;
  scheduleEffectiveFrom: Date;
  scheduleEffectiveTo: Date | null;
  limits: CoverageFigureEntry[];
  sumsInsured: CoverageFigureEntry[];
  namedPerils: string[];
  extensions: string[];
  /** From `DocumentTemplate` when a `policy_schedule_summary` row exists;
   * a built-in fallback otherwise (see
   * `policy-schedule-summary-document.service.ts`). */
  bodyEn: string;
  bodyAr: string;
}

function coverageFigureTable(
  entries: CoverageFigureEntry[],
  lang: 'en' | 'ar',
  currency: string,
  heading: string,
): string {
  if (entries.length === 0) return '';
  return `
    <h2>${escapeHtml(heading)}</h2>
    <table>
      ${entries
        .map(
          (e) =>
            `<tr><th>${escapeHtml(e.key)}</th><td>${formatDocumentMoney(
              { toString: () => String(e.value) },
              lang,
              currency,
            )}</td></tr>`,
        )
        .join('')}
    </table>
  `;
}

function listCell(values: string[]): string {
  return values.length === 0
    ? '—'
    : values.map((v) => escapeHtml(v)).join(', ');
}

function renderSection(
  data: PolicyScheduleSummaryData,
  lang: 'en' | 'ar',
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = lang === 'ar' ? 'ملخص جدول الوثيقة' : 'Policy Schedule Summary';

  const issuedCell =
    data.issuedPremium === null
      ? '—'
      : `${formatDocumentMoney(data.issuedPremium, lang, data.currency)}${
          data.premiumVariance !== null
            ? ` (Δ ${formatDocumentMoney(
                { toString: () => data.premiumVariance as string },
                lang,
                data.currency,
              )})`
            : ''
        }`;

  /*
   * 🔴 DECISION 165 RULING 3 — AN OPEN SCHEDULE IS AN UNSUPERSEDED VERSION, NOT AN
   * OPEN-ENDED COVER, AND A PAPER A CUSTOMER RECEIVES SAID THE SECOND.
   *
   * `PolicySchedule.effectiveTo === null` is the version-chain terminator (the partial UNIQUE
   * `PolicySchedule_one_open_per_policy`; `policy-checking.service.ts` resolves the issued cover
   * by it; an endorsement CLOSES it before opening a successor). So null means «nothing has
   * superseded this», and this document printed «مستمر» two rows under its own
   * «تاريخ الانتهاء» cell.
   *
   * ⟶ The cover an unsuperseded schedule describes runs to the policy's expiry, and
   * `data.expiryDate` is already on this payload — no query and no field was added. «مستمر» /
   * «ongoing» keep their own words and still render where they are TRUE: a policy carrying no
   * expiry date, which `Policy.expiryDate` being nullable permits.
   *
   * ⚠️ The screen's own copy of this line is in `PolicySection.tsx`; both move together.
   */
  const scheduleEnd = data.scheduleEffectiveTo ?? data.expiryDate;
  const scheduleRange = `${formatDocumentDate(data.scheduleEffectiveFrom, lang)} – ${
    scheduleEnd
      ? formatDocumentDate(scheduleEnd, lang)
      : lang === 'ar'
        ? 'مستمر'
        : 'ongoing'
  }`;

  /*
   * THE INSURER AND THE LINE IN THE READER'S LANGUAGE — decision 153 §U2, applied to the
   * four documents that were REPORTED when the certificate was fixed.
   *
   * The same two helpers the certificate uses, and the same one-way fallback: Arabic missing
   * renders the Latin name, and an English render never shows Arabic.
   */
  const insurer = preferLanguage(data.insurerName, data.insurerNameAr, lang);
  const line = preferLanguage(data.insuranceLine, data.insuranceLineAr, lang);

  const metaRows: [string, string][] =
    lang === 'ar'
      ? [
          ['العميل', escapeHtml(data.customerLegalName)],
          ['شركة التأمين', escapeHtml(insurer)],
          ['رقم الوثيقة', escapeHtml(data.policyNumber ?? '—')],
          // 🔴 «خط التأمين» -> «فرع التأمين», decision 150 ruling 5, as on the certificate.
          // This label is hard-coded in the api templates rather than in the dictionary, which
          // is why it was not in her nineteen-string table.
          ['فرع التأمين', escapeHtml(line)],
          [
            'تاريخ السريان',
            data.inceptionDate
              ? formatDocumentDate(data.inceptionDate, 'ar')
              : '—',
          ],
          [
            'تاريخ الانتهاء',
            data.expiryDate ? formatDocumentDate(data.expiryDate, 'ar') : '—',
          ],
          [
            'القسط المطلوب',
            formatDocumentMoney(data.requestedPremium, 'ar', data.currency),
          ],
          ['القسط الصادر', issuedCell],
          ['فترة سريان الجدول', scheduleRange],
        ]
      : [
          ['Customer', escapeHtml(data.customerLegalName)],
          ['Insurer', escapeHtml(insurer)],
          ['Policy Number', escapeHtml(data.policyNumber ?? '—')],
          ['Insurance Line', escapeHtml(line)],
          [
            'Inception',
            data.inceptionDate
              ? formatDocumentDate(data.inceptionDate, 'en')
              : '—',
          ],
          [
            'Expiry',
            data.expiryDate ? formatDocumentDate(data.expiryDate, 'en') : '—',
          ],
          [
            'Requested Premium',
            formatDocumentMoney(data.requestedPremium, 'en', data.currency),
          ],
          ['Issued Premium', issuedCell],
          ['Schedule Period', scheduleRange],
        ];

  const limitsHeading = lang === 'ar' ? 'حدود التغطية' : 'Limits';
  const sumsInsuredHeading = lang === 'ar' ? 'مبالغ التأمين' : 'Sums Insured';
  const perilsLabel = lang === 'ar' ? 'الأخطار المسماة' : 'Named Perils';
  const extensionsLabel = lang === 'ar' ? 'الامتدادات' : 'Extensions';
  const body = lang === 'ar' ? data.bodyAr : data.bodyEn;

  return `
    <section dir="${dir}" lang="${lang}">
      <h1>${title}</h1>
      <p class="meta">${formatDocumentDate(new Date(), lang)}</p>
      <table>
        ${metaRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('')}
      </table>
      ${body
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
      ${coverageFigureTable(data.limits, lang, data.currency, limitsHeading)}
      ${coverageFigureTable(data.sumsInsured, lang, data.currency, sumsInsuredHeading)}
      <p><strong>${escapeHtml(perilsLabel)}:</strong> ${listCell(data.namedPerils)}</p>
      <p><strong>${escapeHtml(extensionsLabel)}:</strong> ${listCell(data.extensions)}</p>
    </section>
  `;
}

export function buildPolicyScheduleSummaryHtml(
  data: PolicyScheduleSummaryData,
  language: DocumentLanguage,
): string {
  const sections =
    language === 'DUAL'
      ? `${renderSection(data, 'ar')}<div class="page-break"></div>${renderSection(data, 'en')}`
      : renderSection(data, language === 'AR' ? 'ar' : 'en');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${DOCUMENT_BASE_CSS}
  h2 { font-size: 16px; margin: 20px 0 8px; }
</style>
</head>
<body>${sections}</body>
</html>`;
}
