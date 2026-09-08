import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentDate,
  formatDocumentMoney,
  type DocumentLanguage,
} from '../document-generation/document-html.util';
import type { CoverageFigureEntry } from './policy.config';

/** Part F item #7 — certificate of insurance, the 6th and FINAL of the 6
 * named document types (after complaint acknowledgement, quotation
 * comparison, recommendation report, policy schedule summary, invoice).
 * Confirms the backlog's own "Derive it from Policy + PolicySchedule"
 * scoping decision (made when the policy-schedule-summary slice was
 * built) applies here too — same underlying data, deliberately different
 * CONTENT.
 *
 * **A genuine Certificate of Insurance convention, confirmed with the
 * user via `AskUserQuestion` before building** — NOT the same content as
 * `policy-schedule-summary.template.ts` under a different heading. A
 * certificate of insurance is a short proof-of-coverage document, often
 * handed to a third party (a landlord, a regulator, a lender) rather than
 * kept as a billing/schedule record: insured, policy number, insurer,
 * insurance line, period of insurance, and a single-line sum-insured
 * summary — deliberately NO premium, tax, commission, or the full
 * limits/named-perils/extensions breakdown the schedule summary already
 * covers in detail.
 *
 * `sumsInsured` is free-form JSON with no fixed key vocabulary (the same
 * `policy.config.ts#assertCoverageFigures` shape the schedule-summary
 * document reads via the now-shared `coverageFigureEntries()`). Rendered
 * here as ONE summary line (`key: money-formatted-value` per entry,
 * joined by "; ") rather than a full table — this document is a short
 * proof of coverage, not an itemized breakdown.
 *
 * Reuses the SAME `PolicyService.getByIdWithCustomer()` visibility read
 * and the SAME `schedules.length === 0` data-availability gate the
 * schedule-summary slice already established (`policy-schedule-summary-
 * document.service.ts`) — a Policy has nothing to certify until Process
 * 19 issuance records the first schedule, exactly the same precondition
 * a certificate has. */

export interface CertificateOfInsuranceData {
  policyId: string;
  customerLegalName: string;
  policyNumber: string | null;
  insurerName: string;
  insuranceLine: string;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  currency: string;
  sumsInsured: CoverageFigureEntry[];
  /** From `DocumentTemplate` when a `certificate_of_insurance` row
   * exists; a built-in fallback otherwise (see
   * `certificate-of-insurance-document.service.ts`). */
  bodyEn: string;
  bodyAr: string;
}

function sumInsuredSummary(
  entries: CoverageFigureEntry[],
  lang: 'en' | 'ar',
  currency: string,
): string {
  if (entries.length === 0) return '—';
  return entries
    .map(
      (e) =>
        `${escapeHtml(e.key)}: ${formatDocumentMoney(
          { toString: () => String(e.value) },
          lang,
          currency,
        )}`,
    )
    .join('; ');
}

function renderSection(
  data: CertificateOfInsuranceData,
  lang: 'en' | 'ar',
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = lang === 'ar' ? 'شهادة تأمين' : 'Certificate of Insurance';

  const periodRange = `${
    data.inceptionDate ? formatDocumentDate(data.inceptionDate, lang) : '—'
  } – ${data.expiryDate ? formatDocumentDate(data.expiryDate, lang) : lang === 'ar' ? 'مستمر' : 'ongoing'}`;

  const metaRows: [string, string][] =
    lang === 'ar'
      ? [
          ['رقم المرجع', escapeHtml(data.policyId)],
          ['المؤمَّن له', escapeHtml(data.customerLegalName)],
          ['رقم الوثيقة', escapeHtml(data.policyNumber ?? '—')],
          ['شركة التأمين', escapeHtml(data.insurerName)],
          ['خط التأمين', escapeHtml(data.insuranceLine)],
          ['فترة التأمين', periodRange],
          [
            'مبلغ التأمين',
            sumInsuredSummary(data.sumsInsured, 'ar', data.currency),
          ],
        ]
      : [
          ['Reference', escapeHtml(data.policyId)],
          ['Insured', escapeHtml(data.customerLegalName)],
          ['Policy Number', escapeHtml(data.policyNumber ?? '—')],
          ['Insurer', escapeHtml(data.insurerName)],
          ['Insurance Line', escapeHtml(data.insuranceLine)],
          ['Period of Insurance', periodRange],
          [
            'Sum Insured',
            sumInsuredSummary(data.sumsInsured, 'en', data.currency),
          ],
        ];

  const certifyText =
    lang === 'ar'
      ? 'تشهد هذه الوثيقة بأن المؤمَّن له المذكور أعلاه يحمل التغطية التالية، السارية حالياً بتاريخ إصدار هذه الشهادة.'
      : 'This certifies that the below-named insured holds the following coverage, currently in force as at the date of this certificate.';

  const body = lang === 'ar' ? data.bodyAr : data.bodyEn;

  return `
    <section dir="${dir}" lang="${lang}">
      <h1>${title}</h1>
      <p class="meta">${formatDocumentDate(new Date(), lang)}</p>
      <p>${escapeHtml(certifyText)}</p>
      <table>
        ${metaRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('')}
      </table>
      ${body
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
    </section>
  `;
}

export function buildCertificateOfInsuranceHtml(
  data: CertificateOfInsuranceData,
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
<style>${DOCUMENT_BASE_CSS}</style>
</head>
<body>${sections}</body>
</html>`;
}
