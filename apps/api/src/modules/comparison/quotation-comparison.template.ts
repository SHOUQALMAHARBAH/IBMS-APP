import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentBiPeriod,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  preferLanguage,
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
  /** The insurer's Arabic name, or null where none is recorded. Already resolved by
   *  `insurerIdentity()` in the comparison VIEW — one source, both names — so the document
   *  service reads it off the row rather than resolving it a second time. */
  insurerNameAr: string | null;
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

/**
 * ⚠️ REPORTED, NOT FIXED — this type carries ONE name where the rest of the table carries two.
 *
 * `QuotationComparisonRow` holds `insurerName` AND `insurerNameAr`, and the template resolves
 * the pair by language. This does not: `comparison.service.ts` fills it through `insurerName()`,
 * the single-name resolver, so an insurer that never responded and one that declined print in
 * LATIN on the Arabic comparison while every insurer in the table above prints in Arabic. One
 * paper, two rules about the same company's name.
 *
 * ⛔ Not fixed here. Message 51 §3 item 5 says report it, and the fix is the same shape as the
 * Arabic LINE name the message defers: the resolver and the service both move to the bilingual
 * pair (`resolveInsurerNamePair`), which is a query-and-view change on two more call sites.
 * Doing half of it — widening the type without filling it — would put a field on the wire that
 * is always null and read as done.
 */
export interface FlaggedInsurerData {
  name: string;
  status: string | null;
}

export interface QuotationComparisonData {
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

function supersededTag(lang: 'en' | 'ar'): string {
  return lang === 'ar'
    ? ' <span style="opacity:0.6;font-size:0.8em">(نسخة سابقة)</span>'
    : ' <span style="opacity:0.6;font-size:0.8em">(superseded)</span>';
}

function renderRow(row: QuotationComparisonRow, lang: 'en' | 'ar'): string {
  // THE INSURER IN THE READER'S LANGUAGE — decision 153 §U2, applied to this document.
  const insurer = preferLanguage(row.insurerName, row.insurerNameAr, lang);
  const cells = [
    `${escapeHtml(insurer)}${row.isCurrentVersion ? '' : supersededTag(lang)}`,
    formatDocumentMoney(row.premium, lang, row.currency),
    formatDocumentMoney(row.deductible, lang, row.currency),
    formatDocumentMoney(row.liabilityLimit, lang, row.currency),
    formatDocumentBiPeriod(row.biPeriodMonths, lang),
    formatDocumentPercent(row.commissionRatePercent, lang),
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

/**
 * 🔴 OWNER DECISION 155 RULING 3 — the insurer's response state, in words.
 *
 * This printed `submission.status` AS STORED, so an Arabic comparison handed to a customer said
 * «شركة الشرق الأوسط (NO_RESPONSE)». It is a database token, in English, inside a sentence the
 * customer is meant to read — decision 49's subject exactly.
 *
 * ⚠️ COPIED, not imported. An api template cannot read `apps/web`'s dictionary — they are
 * separate builds — and every other label in this file is copied the same way. What stops the
 * two drifting is `quotation-comparison.template.spec.ts`, which reads
 * `apps/web/lib/i18n/translations/rfq.ts` and asserts these ten strings are byte-equal to
 * `rfqInsurerStatus*`. ⛔ Do not reword one half.
 *
 * TOTAL over `RfqInsurerStatus`, so a sixth member is a TYPE ERROR here rather than a raw token
 * on a customer's paper.
 */
const INSURER_STATUS_LABEL: Record<
  'en' | 'ar',
  Record<'SENT' | 'VIEWED' | 'QUOTED' | 'DECLINED' | 'NO_RESPONSE', string>
> = {
  ar: {
    SENT: 'أُرسل',
    VIEWED: 'اطُّلع عليه',
    QUOTED: 'قدَّم عرضاً',
    DECLINED: 'رفض',
    NO_RESPONSE: 'لا استجابة',
  },
  en: {
    SENT: 'Sent',
    VIEWED: 'Viewed',
    QUOTED: 'Quoted',
    DECLINED: 'Declined',
    NO_RESPONSE: 'No response',
  },
};

function flaggedList(
  insurers: FlaggedInsurerData[],
  lang: 'en' | 'ar',
  withStatus: boolean,
): string {
  return insurers
    .map((i) => {
      const name = escapeHtml(i.name);
      if (!withStatus || !i.status) return name;
      /*
       * A status the map does not know renders AS STORED (decision 49) rather than blank. The
       * column is a Prisma enum, so this branch is unreachable today — and an unreachable
       * fallback that prints the token beats a reachable one that prints nothing.
       */
      const shown =
        INSURER_STATUS_LABEL[lang][
          i.status as keyof (typeof INSURER_STATUS_LABEL)['ar']
        ] ?? i.status;
      return `${name} (${escapeHtml(shown)})`;
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
          // 🔴 «خط التأمين» -> «فرع التأمين», decision 150 ruling 5, as on the certificate.
          //
          // ⚠️ THE VALUE BESIDE IT IS STILL THE STORED ENGLISH LINE, reported rather than
          // fixed: `COMPARISON_INCLUDE` selects the RFQ's `insuranceLine` STRING only — not
          // the catalogue rows — so there is no Arabic name here to read, and giving it one
          // is a query change that §1 of this message rules out.
          ['فرع التأمين', data.insuranceLine],
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
