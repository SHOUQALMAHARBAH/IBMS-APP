import { Injectable } from '@nestjs/common';
import { ComparisonService } from './comparison.service';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import type { DocumentLanguage } from '../document-generation/document-html.util';
import { buildQuotationComparisonHtml } from './quotation-comparison.template';
import type { AuthenticatedUser } from '../auth/auth.types';

const QUOTATION_COMPARISON_TEMPLATE_TYPE = 'quotation_comparison';

/** Built-in fallback boilerplate — used whenever no `quotation_comparison`
 * `DocumentTemplate` row exists yet. Byte-identical to the real seed row
 * (`packages/db/prisma/seed-data/document-templates.ts`) so the two never
 * silently diverge — the same guarantee `ComplaintAcknowledgementService`
 * already established for the first document type. */
const FALLBACK_BODY_EN =
  'The following is a structured comparison of the quotations received ' +
  'for this insurance requirement. Coverage, exclusions, deductibles, ' +
  'limits, and insurer service quality have all been considered ' +
  'alongside price — this comparison should never be read on price ' +
  'alone.';
const FALLBACK_BODY_AR =
  'فيما يلي مقارنة منظّمة لعروض التأمين الواردة لهذا الطلب. تم النظر في ' +
  'التغطية والاستثناءات والتحملات وحدود التغطية وجودة خدمة شركة التأمين ' +
  'إلى جانب السعر — لا ينبغي قراءة هذه المقارنة بناءً على السعر فقط.';

export interface GeneratedDocument {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class QuotationComparisonDocumentService {
  constructor(
    private readonly comparisons: ComparisonService,
    private readonly templates: DocumentTemplateRepository,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  async generate(
    comparisonId: string,
    requestedLanguage: DocumentLanguage | undefined,
    actor: AuthenticatedUser,
  ): Promise<GeneratedDocument> {
    // getByIdWithCustomer enforces the SAME visibility rule as every other
    // comparison-matrix read (the matrix inherits its RFQ's Opportunity's
    // Customer's visibility) — this call is the only authorization gate
    // for this whole method; nothing below re-derives the matrix from a
    // caller-supplied id.
    const { view, customer } = await this.comparisons.getByIdWithCustomer(
      comparisonId,
      actor,
    );

    const template = await this.templates.findByType(
      QUOTATION_COMPARISON_TEMPLATE_TYPE,
    );

    const language: DocumentLanguage =
      requestedLanguage ?? customer.languagePreference;

    const html = buildQuotationComparisonHtml(
      {
        comparisonId: view.id,
        insuranceLine: view.insuranceLine,
        customerLegalName: customer.legalName,
        builtAt: view.builtAt,
        rows: view.rows.map((r) => ({
          insurerName: r.quotation.insurer.name,
          isCurrentVersion: r.quotation.isCurrentVersion,
          premium: r.quotation.premium,
          currency: r.quotation.currency,
          deductible: r.quotation.deductible,
          liabilityLimit: r.quotation.liabilityLimit,
          biPeriodMonths: r.quotation.biPeriodMonths,
          commissionRatePercent: r.quotation.commissionRatePercent,
          insurerQualityScore: r.insurerQualityScore,
          serviceScore: r.serviceScore,
          exclusions: r.quotation.exclusions,
          conditions: r.quotation.conditions,
        })),
        missingInsurers: view.missingInsurers,
        declinedInsurers: view.declinedInsurers,
        bodyEn: template?.bodyEn ?? FALLBACK_BODY_EN,
        bodyAr: template?.bodyAr ?? FALLBACK_BODY_AR,
      },
      language,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html);
    return {
      buffer,
      fileName: `quotation-comparison-${view.id}.pdf`,
    };
  }
}
