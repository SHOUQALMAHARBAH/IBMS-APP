import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import type { DocumentLanguage } from '../document-generation/document-html.util';
import { buildInvoiceHtml } from './invoice-document.template';

const INVOICE_TEMPLATE_TYPE = 'invoice';

/** Built-in fallback boilerplate — used whenever no `invoice`
 * `DocumentTemplate` row exists yet. Byte-identical to the real seed row
 * (`packages/db/prisma/seed-data/document-templates.ts`) so the two never
 * silently diverge — the same guarantee every earlier item #7 document
 * type already established. */
const FALLBACK_BODY_EN =
  'This is your invoice for the insurance premium below. Please arrange ' +
  'payment by the due date shown. Contact us promptly if you have any ' +
  'questions about this invoice.';
const FALLBACK_BODY_AR =
  'هذه فاتورتكم لقسط التأمين المبيّن أدناه. يرجى ترتيب السداد قبل تاريخ ' +
  'الاستحقاق المذكور. يرجى التواصل معنا فوراً في حال وجود أي استفسار ' +
  'بخصوص هذه الفاتورة.';

export interface GeneratedDocument {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class InvoiceDocumentService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly customers: CustomerRepository,
    private readonly policies: PolicyRepository,
    private readonly templates: DocumentTemplateRepository,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  async generate(
    invoiceId: string,
    requestedLanguage: DocumentLanguage | undefined,
  ): Promise<GeneratedDocument> {
    // `client-accounting.read` (the same permission `InvoiceController.get()`
    // uses) is a flat, book-wide Finance permission — Invoice has NO
    // per-customer visibility scoping beyond it (confirmed by reading
    // InvoiceService/InvoiceController before building this: the same
    // class of flat-permission entity `ComplaintAcknowledgementService`
    // already established, unlike Policy/ComparisonMatrix/Recommendation'
    // s scoped `getByIdWithCustomer`). No visibility-preserving-read
    // helper is needed here — a bare repository read is already correct.
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found.`);
    }
    const customer = await this.customers.findById(invoice.customerId);
    if (!customer) {
      throw new NotFoundException(`Customer ${invoice.customerId} not found.`);
    }
    // `Invoice.policyId` is schema-nullable, though every invoice #31
    // creates today always carries one — tolerate the null case rather
    // than assume it away.
    const policy = invoice.policyId
      ? await this.policies.findById(invoice.policyId)
      : null;

    const template = await this.templates.findByType(INVOICE_TEMPLATE_TYPE);

    const language: DocumentLanguage =
      requestedLanguage ?? customer.languagePreference;

    const receipt = invoice.receipts[0] ?? null;

    const html = buildInvoiceHtml(
      {
        invoiceId: invoice.id,
        customerLegalName: customer.legalName,
        policyNumber: policy?.policyNumber ?? null,
        insuranceLine: policy?.insuranceLine ?? null,
        insurerName: policy?.insurer?.name ?? null,
        invoiceDate: invoice.createdAt,
        dueDate: invoice.dueDate,
        premiumAmount: invoice.premiumAmount,
        taxAmount: invoice.taxAmount,
        feesAmount: invoice.feesAmount,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
        receipt: receipt
          ? {
              amount: receipt.amount,
              method: receipt.method,
              receivedAt: receipt.receivedAt,
            }
          : null,
        bodyEn: template?.bodyEn ?? FALLBACK_BODY_EN,
        bodyAr: template?.bodyAr ?? FALLBACK_BODY_AR,
      },
      language,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html);
    return {
      buffer,
      fileName: `invoice-${invoice.id}.pdf`,
    };
  }
}
