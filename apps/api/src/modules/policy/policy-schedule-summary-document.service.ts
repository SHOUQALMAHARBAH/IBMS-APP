import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { coverageFigureEntries, premiumVariance } from './policy.config';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import type { DocumentLanguage } from '../document-generation/document-html.util';
import { buildPolicyScheduleSummaryHtml } from './policy-schedule-summary.template';
import type { AuthenticatedUser } from '../auth/auth.types';

const POLICY_SCHEDULE_SUMMARY_TEMPLATE_TYPE = 'policy_schedule_summary';

/** Built-in fallback boilerplate — used whenever no
 * `policy_schedule_summary` `DocumentTemplate` row exists yet.
 * Byte-identical to the real seed row
 * (`packages/db/prisma/seed-data/document-templates.ts`) so the two
 * never silently diverge — the same guarantee every earlier item #7
 * document type already established. */
const FALLBACK_BODY_EN =
  'This document summarizes the coverage currently in force under this ' +
  'policy, as recorded from the insurer-issued schedule. Please review ' +
  'the limits, sums insured, named perils and extensions below, and ' +
  'contact us promptly if anything does not match your requirements.';
const FALLBACK_BODY_AR =
  'يلخّص هذا المستند التغطية السارية حالياً بموجب هذه الوثيقة، كما وردت ' +
  'في الجدول الصادر عن شركة التأمين. يرجى مراجعة الحدود ومبالغ التأمين ' +
  'والأخطار المسماة والامتدادات أدناه، والتواصل معنا فوراً في حال وجود ' +
  'أي تعارض مع متطلباتكم.';

export interface GeneratedDocument {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class PolicyScheduleSummaryDocumentService {
  constructor(
    private readonly policies: PolicyService,
    private readonly templates: DocumentTemplateRepository,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  async generate(
    policyId: string,
    requestedLanguage: DocumentLanguage | undefined,
    actor: AuthenticatedUser,
  ): Promise<GeneratedDocument> {
    // getByIdWithCustomer enforces the SAME visibility rule as every
    // other policy read (a policy inherits its Customer's visibility,
    // plus a Policy Checking Officer's cross-book reach) — this call is
    // the only authorization gate for this whole method; nothing below
    // re-derives the policy from a caller-supplied id.
    const { policy, customer } = await this.policies.getByIdWithCustomer(
      policyId,
      actor,
    );

    // Data-availability gate, not a business-workflow one: there is no
    // schedule to summarize until Process 19 issuance records the first
    // one (`schedules` ordered `effectiveFrom desc` — see
    // `PolicyRepository`'s own `POLICY_INCLUDE`).
    const schedule = policy.schedules[0];
    if (!schedule) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} has not yet been issued — there is no coverage schedule to summarize.`,
      );
    }

    const template = await this.templates.findByType(
      POLICY_SCHEDULE_SUMMARY_TEMPLATE_TYPE,
    );

    const language: DocumentLanguage =
      requestedLanguage ?? customer.languagePreference;

    const html = buildPolicyScheduleSummaryHtml(
      {
        policyId: policy.id,
        customerLegalName: customer.legalName,
        insurerName: policy.insurer?.name ?? policy.insurerId,
        policyNumber: policy.policyNumber,
        insuranceLine: policy.insuranceLine,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        requestedPremium: policy.requestedPremium,
        issuedPremium: policy.issuedPremium,
        premiumVariance: premiumVariance(
          policy.requestedPremium,
          policy.issuedPremium,
        ),
        currency: policy.currency,
        scheduleEffectiveFrom: schedule.effectiveFrom,
        scheduleEffectiveTo: schedule.effectiveTo,
        limits: coverageFigureEntries(schedule.limits),
        sumsInsured: coverageFigureEntries(schedule.sumsInsured),
        namedPerils: schedule.namedPerils,
        extensions: schedule.extensions,
        bodyEn: template?.bodyEn ?? FALLBACK_BODY_EN,
        bodyAr: template?.bodyAr ?? FALLBACK_BODY_AR,
      },
      language,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html);
    return {
      buffer,
      fileName: `policy-schedule-summary-${policy.id}.pdf`,
    };
  }
}
