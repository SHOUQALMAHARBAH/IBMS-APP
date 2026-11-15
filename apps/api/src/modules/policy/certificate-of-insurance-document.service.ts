import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { coverageFigureEntries } from './policy.config';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import type { DocumentLanguage } from '../document-generation/document-html.util';
import { buildCertificateOfInsuranceHtml } from './certificate-of-insurance.template';
import type { AuthenticatedUser } from '../auth/auth.types';
import { insurerName } from '../../repositories/insurer-identity';
import { LicenseGateService } from '../compliance-risk/license-gate.service';

const CERTIFICATE_OF_INSURANCE_TEMPLATE_TYPE = 'certificate_of_insurance';

/*
 * 🔴 OWNER DECISION 136(أ) — THE RENEWAL STAMP IS NEVER PRINTED ON THIS DOCUMENT, AND THAT IS A
 * RULING RATHER THAN A DEFERRAL.
 *
 * «صدرت والتجديد قيد الدراسة» shows on every SCREEN that displays a record issued while the
 * office's renewal was under study, and in that record's own log. It is not printed on paper the
 * customer receives — this certificate, the policy schedule summary, or the recommendation report.
 * Her reason is in the decision: no provision of Instructions No. 9 of 2026 and nothing in the
 * adviser's written opinion requires the customer to be told on the page, and art. 19/c already
 * protects them on the premium — so printing it would be an assertion on a customer's document
 * with no source behind it.
 *
 * ⟶ Reopened only by a Central Bank text, the signed legal opinion, or a ruling of hers.
 *
 * ## 🔴 AND A MEASUREMENT THAT CONTRADICTS THE PREMISE OF THE STAMP ITSELF — 2026-11-15
 *
 * Decision 136 §6 and message 40 §1.2 both say the certificate is stamped on «the `Document` row
 * that the `ISSUE_CERTIFICATE` act creates». **There is no such row.** Measured: this service
 * renders a PDF and returns a buffer, the route returns a `StreamableFile`, and nothing here
 * writes a `Document`, an audit entry, or any other record — and the same is true of the policy
 * schedule summary and the recommendation report. On dev the `Document` table holds only
 * `APPLICATION_PROPOSAL`, `BROKER_LICENSE_CERTIFICATE`, `INSURER_LICENSE_CERTIFICATE` and
 * `OTHER`; there is not one certificate-of-insurance row, because the act has never created one.
 *
 * ⛔ So the sixth issuance act has NOTHING TO STAMP, and that is an owner decision rather than an
 * engineering one: persisting certificates is a new capability (object storage, a category, a
 * classification, a retention consequence), not a column. Reported in message 40's report;
 * `docs/module-1-decision-128-sizing.md` carries the shape of the other five.
 */

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
    private readonly licenseGate: LicenseGateService,
  ) {}

  async generate(
    policyId: string,
    requestedLanguage: DocumentLanguage | undefined,
    actor: AuthenticatedUser,
  ): Promise<GeneratedDocument> {
    /*
     * ز.١ — ISSUING AN INSURANCE CERTIFICATE, blocked when the office may not practise.
     *
     * Gated even though this is a GET, because the ACT is what the owner named and the harm is
     * specific: this document exists to be handed to a third party — a landlord, a lender, a
     * regulator — who relies on it as proof of cover. An unlicensed broker certifying cover to
     * somebody outside the relationship is the harm, and it is irreversible once the certificate
     * is in their hands.
     *
     * It is the FIRST thing checked, before the visibility read, because the licence is the one
     * thing the caller cannot change by editing the request.
     *
     * The SCHEDULE SUMMARY beside it is deliberately NOT gated: that is the office's own record of
     * what it placed, which ز.٢ protects as work on existing business. The certificate is an
     * assertion to a third party; the summary is a statement to the customer about their own file.
     */
    await this.licenseGate.assertMayPractise('ISSUE_CERTIFICATE', async () => {
      // Art. 21/b/5 — LAZY, so the licence check keeps its documented place ahead of the
      // reads and costs no extra query unless the office actually has a partial suspension.
      const { policy } = await this.policies.getByIdWithCustomer(
        policyId,
        actor,
      );
      return policy;
    });

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
        insurerName: policy.insurer
          ? insurerName(policy.insurer)
          : policy.insurerId,
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
