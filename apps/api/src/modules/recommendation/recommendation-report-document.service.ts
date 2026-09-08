import { Injectable } from '@nestjs/common';
import { RecommendationService } from './recommendation.service';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import type { DocumentLanguage } from '../document-generation/document-html.util';
import { buildRecommendationReportHtml } from './recommendation-report.template';
import type { AuthenticatedUser } from '../auth/auth.types';

const RECOMMENDATION_REPORT_TEMPLATE_TYPE = 'recommendation_report';

/** Built-in fallback boilerplate — used whenever no `recommendation_report`
 * `DocumentTemplate` row exists yet. Byte-identical to the real seed row
 * (`packages/db/prisma/seed-data/document-templates.ts`) so the two never
 * silently diverge. */
const FALLBACK_BODY_EN =
  'Based on a structured comparison of the quotations received for this ' +
  'insurance requirement, we recommend the following. Our assessment ' +
  'considered coverage, price, insurer financial strength, claims ' +
  'service, deductible, and policy conditions together — never price ' +
  'alone.';
const FALLBACK_BODY_AR =
  'بناءً على مقارنة منظّمة لعروض التأمين الواردة لهذا الطلب، نوصي بما ' +
  'يلي. أخذ تقييمنا بعين الاعتبار التغطية والسعر والقوة المالية لشركة ' +
  'التأمين وخدمة المطالبات والتحمل وشروط الوثيقة معاً — وليس السعر فقط.';

export interface GeneratedDocument {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class RecommendationReportDocumentService {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly templates: DocumentTemplateRepository,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  async generate(
    recommendationId: string,
    requestedLanguage: DocumentLanguage | undefined,
    actor: AuthenticatedUser,
  ): Promise<GeneratedDocument> {
    // getByIdWithCustomer enforces BOTH the visibility rule every
    // recommendation read already has AND the send-readiness gate (a
    // deliberate, user-confirmed decision) — the only authorization/
    // business-state check for this whole method.
    const { view, customer, recommendation } =
      await this.recommendations.getByIdWithCustomer(recommendationId, actor);

    const template = await this.templates.findByType(
      RECOMMENDATION_REPORT_TEMPLATE_TYPE,
    );

    const language: DocumentLanguage =
      requestedLanguage ?? customer.languagePreference;

    // Real Prisma.Decimal fields straight off the raw recommendation
    // (never `view`'s already-formatted display strings) — the same
    // raw-Decimal-in pattern `QuotationComparisonDocumentService` already
    // uses, avoiding an unnecessary format-then-reparse round-trip
    // through `view`'s own `formatMoney()`/`.toFixed(2)` output
    // (`@code-reviewer` MINOR, this slice's own first pass).
    const q = recommendation.recommendedQuotation;
    const html = buildRecommendationReportHtml(
      {
        recommendationId: view.id,
        customerLegalName: customer.legalName,
        insuranceLine: q.rfq.insuranceLine,
        createdAt: view.createdAt,
        insurerName: q.insurer.name,
        premium: q.premium,
        currency: q.currency,
        deductible: q.deductible,
        liabilityLimit: q.liabilityLimit,
        biPeriodMonths: q.biPeriodMonths,
        commissionRatePercent: q.commissionRatePercent,
        exclusions: q.exclusions,
        conditions: q.conditions,
        rationale: view.rationale,
        rationaleFactors: view.rationaleFactors,
        conflictOfInterestFlagged: view.conflictOfInterestFlagged,
        conflictOfInterestDisclosureText:
          view.conflictOfInterestDisclosure?.disclosureText ?? null,
        bodyEn: template?.bodyEn ?? FALLBACK_BODY_EN,
        bodyAr: template?.bodyAr ?? FALLBACK_BODY_AR,
      },
      language,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html);
    return {
      buffer,
      fileName: `recommendation-report-${view.id}.pdf`,
    };
  }
}
