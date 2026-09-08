import { Injectable, NotFoundException } from '@nestjs/common';
import { ComplaintRepository } from '../../repositories/complaint.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';
import { PdfRendererService } from '../document-generation/pdf-renderer.service';
import {
  buildComplaintAcknowledgementHtml,
  type AcknowledgementLanguage,
} from './complaint-acknowledgement.template';

const COMPLAINT_ACKNOWLEDGEMENT_TEMPLATE_TYPE = 'complaint_acknowledgement';

/** Built-in fallback boilerplate — used whenever no
 * `complaint_acknowledgement` `DocumentTemplate` row exists yet (a fresh
 * environment before anyone seeds/edits one). Generation must not hard-fail
 * over a missing EDITABLE-prose row; this keeps the same wording the real
 * seed row (`packages/db/prisma/seed-data/document-templates.ts`) uses. */
const FALLBACK_BODY_EN =
  'Thank you for contacting us. We confirm that we have received your ' +
  'complaint and that it has been logged for review. Our team will ' +
  'investigate the matter and keep you informed of its progress.\n' +
  'We appreciate your patience and your continued trust in us.';
const FALLBACK_BODY_AR =
  'شكراً لتواصلكم معنا. نؤكد استلام شكواكم وتسجيلها للمراجعة. سيقوم ' +
  'فريقنا بدراسة الموضوع وإبقائكم على اطلاع بمستجداته.\n' +
  'نقدّر صبركم وثقتكم المستمرة بنا.';

export interface GeneratedDocument {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class ComplaintAcknowledgementService {
  constructor(
    private readonly complaints: ComplaintRepository,
    private readonly customers: CustomerRepository,
    private readonly templates: DocumentTemplateRepository,
    private readonly pdfRenderer: PdfRendererService,
  ) {}

  async generate(
    complaintId: string,
    requestedLanguage: AcknowledgementLanguage | undefined,
  ): Promise<GeneratedDocument> {
    const complaint = await this.complaints.findById(complaintId);
    if (!complaint) {
      throw new NotFoundException(`Complaint ${complaintId} not found.`);
    }
    const customer = await this.customers.findById(complaint.customerId);
    if (!customer) {
      throw new NotFoundException(
        `Customer ${complaint.customerId} not found.`,
      );
    }

    const template = await this.templates.findByType(
      COMPLAINT_ACKNOWLEDGEMENT_TEMPLATE_TYPE,
    );

    const language: AcknowledgementLanguage =
      requestedLanguage ?? customer.languagePreference;

    const html = buildComplaintAcknowledgementHtml(
      {
        complaintId: complaint.id,
        customerLegalName: customer.legalName,
        issue: complaint.issue,
        category: complaint.category,
        createdAt: complaint.createdAt,
        dueAt: complaint.slaTimer?.dueAt ?? null,
        bodyEn: template?.bodyEn ?? FALLBACK_BODY_EN,
        bodyAr: template?.bodyAr ?? FALLBACK_BODY_AR,
      },
      language,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html);
    return {
      buffer,
      fileName: `complaint-acknowledgement-${complaint.id}.pdf`,
    };
  }
}
