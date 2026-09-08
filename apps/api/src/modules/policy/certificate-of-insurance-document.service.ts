import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { coverageFigureEntries } from './policy.config';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import type { DocumentLanguage } from '../document-generation/document-html.util';
import { buildCertificateOfInsuranceHtml } from './certificate-of-insurance.template';
import type { AuthenticatedUser } from '../auth/auth.types';

const CERTIFICATE_OF_INSURANCE_TEMPLATE_TYPE = 'certificate_of_insurance';

/** Built-in fallback boilerplate — used whenever no
 * `certificate_of_insurance` `DocumentTemplate` row exists yet.
 * Byte-identical to the real seed row
 * (`packages/db/prisma/seed-data/document-templates.ts`) so the two
 * never silently diverge — the same guarantee every earlier item #7
 * document type already established. */
const FALLBACK_BODY_EN =
  'This certificate is issued as a summary of coverage currently in ' +
  'force and is not evidence of a contract of insurance — the policy ' +
  'wording governs. Please contact us promptly if any detail below ' +
  'does not match your requirements.';
const FALLBACK_BODY_AR =
  'تصدر هذه الشهادة كملخص للتغطية السارية حالياً وليست دليلاً على عقد ' +
  'التأمين — تحكمها شروط الوثيقة. يرجى التواصل معنا فوراً في حال وجود ' +
  'أي تعارض بين ما ورد أدناه ومتطلباتكم.';

export interface GeneratedDocument {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class CertificateOfInsuranceDocumentService {
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
    // The SAME visibility read + data-availability gate the
    // policy-schedule-summary slice already established — see that
    // service's own comments for why. A certificate has nothing to
    // certify until Process 19 issuance records the first schedule
    // either.
    const { policy, customer } = await this.policies.getByIdWithCustomer(
      policyId,
      actor,
    );

    const schedule = policy.schedules[0];
    if (!schedule) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} has not yet been issued — there is no coverage to certify.`,
      );
    }

    // A `@code-reviewer` BLOCKER, fixed here: unlike the policy-schedule-
    // summary document (which only ever presents dates/figures neutrally
    // and explicitly DOES render a cancelled policy's last-closed
    // schedule as an "as at" historical snapshot —
    // policy-schedule-summary.template.ts's own header comment), THIS
    // document makes an unconditional, present-tense "currently in
    // force" attestation — and its own header comment says it is often
    // handed to a third party (a landlord, a regulator, a lender)
    // specifically to rely on as proof of active coverage. Refusing here
    // (the same 422 shape the data-availability gate above already
    // uses) is safer than inventing a new "historical certificate"
    // content shape with no established convention — a certificate of
    // insurance whose whole purpose is proving CURRENT cover has no
    // sourced meaning for a policy that no longer has any.
    if (policy.status === 'CANCELLED' || policy.status === 'EXPIRED') {
      throw new UnprocessableEntityException(
        `Policy ${policyId} is ${policy.status} — coverage is no longer in force, so a certificate of insurance cannot be issued.`,
      );
    }

    const template = await this.templates.findByType(
      CERTIFICATE_OF_INSURANCE_TEMPLATE_TYPE,
    );

    const language: DocumentLanguage =
      requestedLanguage ?? customer.languagePreference;

    const html = buildCertificateOfInsuranceHtml(
      {
        policyId: policy.id,
        customerLegalName: customer.legalName,
        insurerName: policy.insurer?.name ?? policy.insurerId,
        policyNumber: policy.policyNumber,
        insuranceLine: policy.insuranceLine,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        currency: policy.currency,
        sumsInsured: coverageFigureEntries(schedule.sumsInsured),
        bodyEn: template?.bodyEn ?? FALLBACK_BODY_EN,
        bodyAr: template?.bodyAr ?? FALLBACK_BODY_AR,
      },
      language,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html);
    return {
      buffer,
      fileName: `certificate-of-insurance-${policy.id}.pdf`,
    };
  }
}
