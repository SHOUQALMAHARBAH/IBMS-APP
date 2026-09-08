import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentBiPeriod,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  type DocumentLanguage,
} from '../document-generation/document-html.util';

/** Part F item #7 — recommendation report, the third of the 6 named
 * document types. Unlike quotation comparison (an internal working
 * document), this is EXPLICITLY the client-facing artefact Process 16's
 * own `send()` exists to dispatch (`Recommendation.sentToClientAt`) — a
 * deliberate, user-confirmed design decision gates document generation
 * itself on the SAME `blockedFromSend` check `send()` enforces (see
 * `recommendation.service.ts#getByIdWithCustomer()`), so this template
 * never renders for a recommendation still awaiting a required approval
 * or COI disclosure.
 *
 * What's on the document and what's deliberately NOT, a flagged content
 * decision (no sourced house style existed to follow): the recommended
 * quote's full commercial terms (insurer, premium, commission rate,
 * deductible, liability limit, BI period, exclusions/conditions), the
 * rationale, and all 6 factor notes ARE included — a `@code-reviewer`
 * finding on this slice's own first pass caught that omitting the
 * concrete terms left a client unable to learn what was actually being
 * recommended from the document alone, given two of the six factors
 * (`deductible`/`policyConditions`) narrate terms the document never
 * stated. The conflict-of-interest disclosure TEXT is included when
 * flagged (that text exists specifically to be disclosed to the client —
 * omitting it here would defeat its own purpose). Internal governance
 * metadata is deliberately EXCLUDED: who drafted/approved/sent it, the
 * raw `blockedFromSend` gate list, and the raw computed
 * `coiCommissionDiffPercent` figure (the disclosure text itself is the
 * client-facing conveyance of that fact, not a second, redundant
 * exposure of the raw number) — none of that is part of the ADVICE a
 * client needs, only this broker's own internal workflow record of it. */

export interface RecommendationReportData {
  recommendationId: string;
  customerLegalName: string;
  insuranceLine: string;
  createdAt: Date;
  insurerName: string;
  premium: { toString(): string };
  currency: string;
  deductible: { toString(): string } | null;
  liabilityLimit: { toString(): string } | null;
  biPeriodMonths: number | null;
  commissionRatePercent: { toString(): string } | null;
  exclusions: string | null;
  conditions: string | null;
  rationale: string;
  /** Keyed by the same 6 factors `RATIONALE_FACTOR_FIELDS`
   * (`apps/web/lib/recommendation/recommendation-api.ts`) already
   * establishes — `coverage`/`price`/`financialStrength`/
   * `claimsService`/`deductible`/`policyConditions`. */
  rationaleFactors: Record<string, string>;
  conflictOfInterestFlagged: boolean;
  /** Guaranteed non-null whenever `conflictOfInterestFlagged` is true —
   * `getByIdWithCustomer()`'s own gate ensures a flagged recommendation
   * always has its disclosure recorded before a document can be
   * generated at all. */
  conflictOfInterestDisclosureText: string | null;
  /** From `DocumentTemplate` when a `recommendation_report` row exists;
   * a built-in fallback otherwise (see
   * `recommendation-report-document.service.ts`). */
  bodyEn: string;
  bodyAr: string;
}

const FACTOR_LABELS: { key: string; en: string; ar: string }[] = [
  { key: 'coverage', en: 'Coverage', ar: 'التغطية' },
  { key: 'price', en: 'Price', ar: 'السعر' },
  {
    key: 'financialStrength',
    en: 'Insurer Financial Strength',
    ar: 'القوة المالية لشركة التأمين',
  },
  { key: 'claimsService', en: 'Claims Service', ar: 'خدمة المطالبات' },
  { key: 'deductible', en: 'Deductible', ar: 'التحمل' },
  { key: 'policyConditions', en: 'Policy Conditions', ar: 'شروط الوثيقة' },
];

function renderSection(
  data: RecommendationReportData,
  lang: 'en' | 'ar',
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = lang === 'ar' ? 'تقرير التوصية' : 'Recommendation Report';
  const body = lang === 'ar' ? data.bodyAr : data.bodyEn;

  const metaRows: [string, string][] =
    lang === 'ar'
      ? [
          ['رقم المرجع', escapeHtml(data.recommendationId)],
          ['العميل', escapeHtml(data.customerLegalName)],
          ['خط التأمين', escapeHtml(data.insuranceLine)],
          ['تاريخ الإعداد', formatDocumentDate(data.createdAt, 'ar')],
          ['شركة التأمين الموصى بها', escapeHtml(data.insurerName)],
          ['القسط', formatDocumentMoney(data.premium, 'ar', data.currency)],
          ['التحمل', formatDocumentMoney(data.deductible, 'ar', data.currency)],
          [
            'حد المسؤولية',
            formatDocumentMoney(data.liabilityLimit, 'ar', data.currency),
          ],
          [
            'فترة توقف الأعمال',
            formatDocumentBiPeriod(data.biPeriodMonths, 'ar'),
          ],
          [
            'نسبة العمولة',
            formatDocumentPercent(data.commissionRatePercent, 'ar'),
          ],
          [
            'الاستثناءات / الشروط',
            escapeHtml(
              [data.exclusions, data.conditions].filter(Boolean).join(' / ') ||
                '—',
            ),
          ],
        ]
      : [
          ['Reference', escapeHtml(data.recommendationId)],
          ['Customer', escapeHtml(data.customerLegalName)],
          ['Insurance Line', escapeHtml(data.insuranceLine)],
          ['Prepared', formatDocumentDate(data.createdAt, 'en')],
          ['Recommended Insurer', escapeHtml(data.insurerName)],
          ['Premium', formatDocumentMoney(data.premium, 'en', data.currency)],
          [
            'Deductible',
            formatDocumentMoney(data.deductible, 'en', data.currency),
          ],
          [
            'Liability Limit',
            formatDocumentMoney(data.liabilityLimit, 'en', data.currency),
          ],
          ['BI Period', formatDocumentBiPeriod(data.biPeriodMonths, 'en')],
          [
            'Commission Rate',
            formatDocumentPercent(data.commissionRatePercent, 'en'),
          ],
          [
            'Exclusions / Conditions',
            escapeHtml(
              [data.exclusions, data.conditions].filter(Boolean).join(' / ') ||
                '—',
            ),
          ],
        ];

  const rationaleLabel = lang === 'ar' ? 'التوصية' : 'Rationale';
  const coiTitle =
    lang === 'ar'
      ? 'إفصاح عن تعارض المصالح'
      : 'Conflict-of-Interest Disclosure';

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
      <h2>${rationaleLabel}</h2>
      ${data.rationale
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
      <table>
        ${FACTOR_LABELS.map(
          ({ key, en, ar }) =>
            `<tr><th>${escapeHtml(lang === 'ar' ? ar : en)}</th><td>${escapeHtml(data.rationaleFactors[key] ?? '')}</td></tr>`,
        ).join('')}
      </table>
      ${
        data.conflictOfInterestFlagged && data.conflictOfInterestDisclosureText
          ? `<h2>${coiTitle}</h2>${data.conflictOfInterestDisclosureText
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((line) => `<p>${escapeHtml(line)}</p>`)
              .join('')}`
          : ''
      }
    </section>
  `;
}

export function buildRecommendationReportHtml(
  data: RecommendationReportData,
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
