import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentDate,
  formatDocumentMoney,
  type DocumentLanguage,
} from '../document-generation/document-html.util';

/** Part F item #7 — quotation comparison, the second of the 6 named
 * document types (after complaint acknowledgement). The comparison table's
 * columns mirror `apps/web/components/comparison/ComparisonSection.tsx`'s
 * own existing columns exactly (Insurer / Premium / Deductible / Liability
 * limit / BI period / Commission % / Quality / Service / Exclusions &
 * conditions) — that screen already established which dimensions matter
 * for THIS app's "never price alone" rule
 * (ibms-brain/meta/context/policy-lifecycle.md); this document is a
 * PRINTABLE rendering of the same data, not a second, independently
 * chosen column set. `limits` (a free-form JSON field) is deliberately
 * NOT rendered here either, for the same reason the web screen omits it —
 * no established convention anywhere in this app for displaying it. */

export interface QuotationComparisonRow {
  insurerName: string;
  isCurrentVersion: boolean;
  premium: { toString(): string };
  currency: string;
  deductible: { toString(): string } | null;
  liabilityLimit: { toString(): string } | null;
  biPeriodMonths: number | null;
  commissionRatePercent: { toString(): string } | null;
  insurerQualityScore: { toString(): string } | null;
  serviceScore: { toString(): string } | null;
  exclusions: string | null;
  conditions: string | null;
}

export interface FlaggedInsurerData {
  name: string;
  status: string | null;
}

export interface QuotationComparisonData {
  comparisonId: string;
  insuranceLine: string;
  customerLegalName: string;
  builtAt: Date;
  rows: QuotationComparisonRow[];
  missingInsurers: FlaggedInsurerData[];
  declinedInsurers: FlaggedInsurerData[];
  /** From `DocumentTemplate` when a `quotation_comparison` row exists; a
   * built-in fallback otherwise (see
   * `quotation-comparison-document.service.ts`). */
  bodyEn: string;
  bodyAr: string;
}

const COLUMN_HEADERS: Record<'en' | 'ar', string[]> = {
  en: [
    'Insurer',
    'Premium',
    'Deductible',
    'Liability Limit',
    'BI Period',
    'Commission %',
    'Quality',
    'Service',
    'Exclusions / Conditions',
  ],
  ar: [
    'شركة التأمين',
    'القسط',
    'التحمل',
    'حد المسؤولية',
    'فترة توقف الأعمال',
    'نسبة العمولة',
    'تقييم الجودة',
    'تقييم الخدمة',
    'الاستثناءات / الشروط',
  ],
};

function scoreCell(value: { toString(): string } | null): string {
  return value === null ? '—' : escapeHtml(value.toString());
}

function biPeriodCell(months: number | null, lang: 'en' | 'ar'): string {
  if (months === null) return '—';
  return lang === 'ar' ? `${months} شهر` : `${months} mo`;
}

function commissionCell(
  value: { toString(): string } | null,
  lang: 'en' | 'ar',
): string {
  if (value === null) return '—';
  const pct = escapeHtml(value.toString());
  return lang === 'ar' ? `%${pct}` : `${pct}%`;
}

function supersededTag(lang: 'en' | 'ar'): string {
  return lang === 'ar'
    ? ' <span style="opacity:0.6;font-size:0.8em">(نسخة سابقة)</span>'
    : ' <span style="opacity:0.6;font-size:0.8em">(superseded)</span>';
}

function renderRow(row: QuotationComparisonRow, lang: 'en' | 'ar'): string {
  const cells = [
    `${escapeHtml(row.insurerName)}${row.isCurrentVersion ? '' : supersededTag(lang)}`,
    formatDocumentMoney(row.premium, lang, row.currency),
    formatDocumentMoney(row.deductible, lang, row.currency),
    formatDocumentMoney(row.liabilityLimit, lang, row.currency),
    biPeriodCell(row.biPeriodMonths, lang),
    commissionCell(row.commissionRatePercent, lang),
    scoreCell(row.insurerQualityScore),
    scoreCell(row.serviceScore),
    escapeHtml(
      [row.exclusions, row.conditions].filter(Boolean).join(' / ') || '—',
    ),
  ];
  // insurerName's own cell is already escaped/tag-wrapped above — every
  // OTHER cell is escaped by its own formatter/scoreCell/commissionCell,
  // so no cell here re-escapes an already-safe value.
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

function flaggedList(
  insurers: FlaggedInsurerData[],
  lang: 'en' | 'ar',
  withStatus: boolean,
): string {
  return insurers
    .map((i) => {
      const name = escapeHtml(i.name);
      if (!withStatus || !i.status) return name;
      return `${name} (${escapeHtml(i.status)})`;
    })
    .join(', ');
}

function renderSection(
  data: QuotationComparisonData,
  lang: 'en' | 'ar',
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = lang === 'ar' ? 'مقارنة عروض التأمين' : 'Quotation Comparison';
  const headers = COLUMN_HEADERS[lang];
  const body = lang === 'ar' ? data.bodyAr : data.bodyEn;

  const metaRows: [string, string][] =
    lang === 'ar'
      ? [
          ['العميل', data.customerLegalName],
          ['خط التأمين', data.insuranceLine],
          ['تاريخ الإعداد', formatDocumentDate(data.builtAt, 'ar')],
        ]
      : [
          ['Customer', data.customerLegalName],
          ['Insurance Line', data.insuranceLine],
          ['Prepared', formatDocumentDate(data.builtAt, 'en')],
        ];

  const missingLabel =
    lang === 'ar' ? 'لا يوجد عرض للمقارنة:' : 'No quote to compare:';
  const declinedLabel = lang === 'ar' ? 'معتذرة:' : 'Declined:';

  return `
    <section dir="${dir}" lang="${lang}">
      <h1>${title}</h1>
      <p class="meta">${formatDocumentDate(new Date(), lang)}</p>
      <table>
        ${metaRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}
      </table>
      ${body
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
      <table>
        <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
        ${data.rows.map((r) => renderRow(r, lang)).join('')}
      </table>
      ${
        data.missingInsurers.length > 0
          ? `<p><strong>${missingLabel}</strong> ${flaggedList(data.missingInsurers, lang, true)}</p>`
          : ''
      }
      ${
        data.declinedInsurers.length > 0
          ? `<p><strong>${declinedLabel}</strong> ${flaggedList(data.declinedInsurers, lang, false)}</p>`
          : ''
      }
    </section>
  `;
}

export function buildQuotationComparisonHtml(
  data: QuotationComparisonData,
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
  table:last-of-type th, table:last-of-type td { font-size: 12px; }
</style>
</head>
<body>${sections}</body>
</html>`;
}
