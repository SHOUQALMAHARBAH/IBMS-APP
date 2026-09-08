import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentDate,
  formatDocumentMoney,
  type DocumentLanguage,
} from '../document-generation/document-html.util';

/** Part F item #7 — invoice, the 5th of the 6 named document types (after
 * complaint acknowledgement, quotation comparison, recommendation report,
 * policy schedule summary). A client-facing bill for the premium raised
 * against an issued policy (Process 31).
 *
 * **Content scope — a flagged decision, confirmed with the user via
 * `AskUserQuestion` before building**: `FinanceSection.tsx`'s existing
 * "Billing" block shows `commissionDeducted` / `netRemittance` /
 * `remittance` (the insurer leg) to Finance staff on screen, but this
 * document deliberately EXCLUDES all three — they are internal
 * broker-insurer economics, not part of what the client is being billed
 * for. Mirrors the recommendation-report document's own "internal
 * governance metadata stays internal" precedent. The client's OWN
 * collection `Receipt` (their own payment, not the insurer's remittance)
 * IS shown when one exists — that is the client's own payment history,
 * not a broker-internal figure.
 *
 * **Visibility — a flat permission, not a scoped one.** Unlike
 * Policy/ComparisonMatrix/Recommendation (each with a `getByIdWithCustomer`
 * visibility-preserving-read helper), `Invoice` reads are gated on
 * `client-accounting.read` alone — a book-wide Finance/cross-book
 * reporting permission with NO per-customer visibility filter (confirmed
 * by reading `InvoiceService`/`InvoiceController` before building — the
 * same flat shape `Complaint` has, not the scoped shape the other three
 * document types needed). `InvoiceDocumentService` therefore reads
 * straight off `InvoiceRepository`/`CustomerRepository`, the same shape
 * `ComplaintAcknowledgementService` already established. */

export interface InvoiceReceiptData {
  amount: { toString(): string };
  method: string | null;
  receivedAt: Date;
}

export interface InvoiceDocumentData {
  invoiceId: string;
  customerLegalName: string;
  /** Null when the invoice carries no `policyId` (schema-permitted, though
   * every invoice created by #31 today always has one). */
  policyNumber: string | null;
  insuranceLine: string | null;
  insurerName: string | null;
  invoiceDate: Date;
  dueDate: Date;
  premiumAmount: { toString(): string };
  taxAmount: { toString(): string };
  feesAmount: { toString(): string };
  totalAmount: { toString(): string };
  currency: string;
  receipt: InvoiceReceiptData | null;
  /** From `DocumentTemplate` when an `invoice` row exists; a built-in
   * fallback otherwise (see `invoice-document.service.ts`). */
  bodyEn: string;
  bodyAr: string;
}

function renderSection(data: InvoiceDocumentData, lang: 'en' | 'ar'): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = lang === 'ar' ? 'فاتورة قسط التأمين' : 'Premium Invoice';

  // A `@code-reviewer` MINOR, fixed here: the raw `Invoice.status` enum
  // (`INVOICED → COLLECTED → RECONCILED → RECONCILED → REMITTED`, plus
  // `EXCEPTION_RAISED`/`EXCEPTION_RESOLVED`) describes the BROKER's own
  // internal collection/settlement progress with the insurer — the same
  // class of internal-economics detail this file's own header comment
  // already excludes (`commissionDeducted`/`netRemittance`/
  // `remittance`). A client only needs to know whether THEIR payment is
  // outstanding or received — derived from `data.receipt` (their own
  // collection receipt), never from the raw workflow enum.
  const clientStatus = data.receipt
    ? lang === 'ar'
      ? 'مدفوعة'
      : 'Paid'
    : lang === 'ar'
      ? 'مستحقة'
      : 'Outstanding';

  const metaRows: [string, string][] =
    lang === 'ar'
      ? [
          ['رقم المرجع', escapeHtml(data.invoiceId)],
          ['العميل', escapeHtml(data.customerLegalName)],
          ['رقم الوثيقة', escapeHtml(data.policyNumber ?? '—')],
          ['خط التأمين', escapeHtml(data.insuranceLine ?? '—')],
          ['شركة التأمين', escapeHtml(data.insurerName ?? '—')],
          ['تاريخ الفاتورة', formatDocumentDate(data.invoiceDate, 'ar')],
          ['تاريخ الاستحقاق', formatDocumentDate(data.dueDate, 'ar')],
          ['الحالة', clientStatus],
        ]
      : [
          ['Reference', escapeHtml(data.invoiceId)],
          ['Customer', escapeHtml(data.customerLegalName)],
          ['Policy Number', escapeHtml(data.policyNumber ?? '—')],
          ['Insurance Line', escapeHtml(data.insuranceLine ?? '—')],
          ['Insurer', escapeHtml(data.insurerName ?? '—')],
          ['Invoice Date', formatDocumentDate(data.invoiceDate, 'en')],
          ['Due Date', formatDocumentDate(data.dueDate, 'en')],
          ['Status', clientStatus],
        ];

  const lineItemHeading = lang === 'ar' ? 'تفاصيل الفاتورة' : 'Invoice Details';
  const lineRows: [string, string][] =
    lang === 'ar'
      ? [
          [
            'القسط',
            formatDocumentMoney(data.premiumAmount, 'ar', data.currency),
          ],
          ['الضريبة', formatDocumentMoney(data.taxAmount, 'ar', data.currency)],
          ['الرسوم', formatDocumentMoney(data.feesAmount, 'ar', data.currency)],
          [
            'الإجمالي المستحق',
            formatDocumentMoney(data.totalAmount, 'ar', data.currency),
          ],
        ]
      : [
          [
            'Premium',
            formatDocumentMoney(data.premiumAmount, 'en', data.currency),
          ],
          ['Tax', formatDocumentMoney(data.taxAmount, 'en', data.currency)],
          ['Fees', formatDocumentMoney(data.feesAmount, 'en', data.currency)],
          [
            'Total Due',
            formatDocumentMoney(data.totalAmount, 'en', data.currency),
          ],
        ];

  const receiptHeading = lang === 'ar' ? 'الدفعة المستلمة' : 'Payment Received';
  const receiptSection = data.receipt
    ? `
    <h2>${escapeHtml(receiptHeading)}</h2>
    <table>
      <tr><th>${escapeHtml(lang === 'ar' ? 'المبلغ' : 'Amount')}</th><td>${formatDocumentMoney(
        data.receipt.amount,
        lang,
        data.currency,
      )}</td></tr>
      <tr><th>${escapeHtml(lang === 'ar' ? 'طريقة الدفع' : 'Method')}</th><td>${escapeHtml(
        data.receipt.method ?? '—',
      )}</td></tr>
      <tr><th>${escapeHtml(lang === 'ar' ? 'تاريخ الاستلام' : 'Received')}</th><td>${formatDocumentDate(
        data.receipt.receivedAt,
        lang,
      )}</td></tr>
    </table>`
    : '';

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
      <h2>${escapeHtml(lineItemHeading)}</h2>
      <table>
        ${lineRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('')}
      </table>
      ${receiptSection}
    </section>
  `;
}

export function buildInvoiceHtml(
  data: InvoiceDocumentData,
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
