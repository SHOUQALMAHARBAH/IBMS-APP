import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentDate,
  type DocumentLanguage,
} from '../document-generation/document-html.util';

/** Part F item #7 — complaint acknowledgement, the first of the 6 named
 * document types built (chosen as the vertical slice: simplest real data,
 * lowest risk way to prove generation + bilingual layout + delivery works
 * before extending to the richer document types — a user decision via
 * `AskUserQuestion`). Arabic is this system's PRIMARY language (a user
 * decision, this session): a DUAL document renders the Arabic section
 * first, English second, not the reverse.
 *
 * `DocumentTemplate.bodyEn`/`bodyAr` (Part 11.2) supply the EDITABLE
 * boilerplate prose — the same "compliance/underwriting can revise this
 * without a code change" shape the seeded `proposal_form_*` rows already
 * established (`packages/db/prisma/seed-data/document-templates.ts`).
 * Structured, per-instance facts (reference, dates, category, SLA due
 * date) are NOT stored in the template — they are real domain data, merged
 * in by this function around the boilerplate text, never string-replaced
 * into it. */

export interface ComplaintAcknowledgementData {
  complaintId: string;
  customerLegalName: string;
  issue: string;
  category: string | null;
  createdAt: Date;
  dueAt: Date | null;
  /** From `DocumentTemplate` when a `complaint_acknowledgement` row
   * exists; a built-in fallback otherwise (see
   * `complaint-acknowledgement.service.ts`) — never a hard failure over a
   * missing editable-template row. */
  bodyEn: string;
  bodyAr: string;
}

const CATEGORY_LABELS: Record<string, { en: string; ar: string }> = {
  denied_claim: { en: 'Denied Claim', ar: 'مطالبة مرفوضة' },
  delayed_issuance: { en: 'Delayed Policy Issuance', ar: 'تأخر إصدار الوثيقة' },
  premium_dispute: { en: 'Premium Dispute', ar: 'نزاع على القسط' },
  unanswered_claim: { en: 'Unanswered Claim', ar: 'مطالبة دون رد' },
  other: { en: 'Other', ar: 'أخرى' },
};

function categoryLabel(category: string | null, lang: 'en' | 'ar'): string {
  if (!category) return '—';
  return CATEGORY_LABELS[category]?.[lang] ?? category;
}

function renderSection(
  data: ComplaintAcknowledgementData,
  lang: 'en' | 'ar',
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title =
    lang === 'ar' ? 'إشعار استلام شكوى' : 'Complaint Acknowledgement';
  const rows: [string, string][] =
    lang === 'ar'
      ? [
          ['رقم الشكوى', data.complaintId],
          ['حامل الوثيقة / العميل', data.customerLegalName],
          ['تاريخ التسجيل', formatDocumentDate(data.createdAt, 'ar')],
          ['نوع الشكوى', categoryLabel(data.category, 'ar')],
          ['موضوع الشكوى', data.issue],
          ...(data.dueAt
            ? ([
                ['الرد المتوقع بحلول', formatDocumentDate(data.dueAt, 'ar')],
              ] as [string, string][])
            : []),
        ]
      : [
          ['Complaint Reference', data.complaintId],
          ['Policyholder / Customer', data.customerLegalName],
          ['Date Logged', formatDocumentDate(data.createdAt, 'en')],
          ['Category', categoryLabel(data.category, 'en')],
          ['Issue', data.issue],
          ...(data.dueAt
            ? ([
                ['Expected Response By', formatDocumentDate(data.dueAt, 'en')],
              ] as [string, string][])
            : []),
        ];
  const body = lang === 'ar' ? data.bodyAr : data.bodyEn;

  return `
    <section dir="${dir}" lang="${lang}">
      <h1>${title}</h1>
      <p class="meta">${formatDocumentDate(new Date(), lang)}</p>
      <table>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}
      </table>
      ${body
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
    </section>
  `;
}

export function buildComplaintAcknowledgementHtml(
  data: ComplaintAcknowledgementData,
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
  section { margin-bottom: 0; }
</style>
</head>
<body>${sections}</body>
</html>`;
}
