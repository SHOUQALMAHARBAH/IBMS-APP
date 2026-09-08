import { Module } from '@nestjs/common';
import { PdfRendererService } from './pdf-renderer.service';
import { DocumentTemplateRepository } from '../../repositories/document-template.repository';

/**
 * Part F item #7 — system-generated bilingual documents. Shared,
 * cross-cutting rendering infrastructure only — no controller, no
 * business logic for any specific document type. Each document type
 * (quotation comparison, recommendation report, policy schedule summary,
 * invoice, certificate, complaint acknowledgement) is owned by its own
 * domain module, which imports this one for `PdfRendererService` +
 * `DocumentTemplateRepository` the same way every other cross-cutting
 * service in this codebase is shared (`AuditModule`, `SlaModule`).
 *
 * This pass builds ONE document type (complaint acknowledgement,
 * `CustomerServiceModule`) as the vertical slice proving this
 * infrastructure end-to-end — see
 * `ibms-brain/meta/context/bilingual-ui.md`'s "What item #7 covers" for
 * the other 5, still unbuilt.
 */
@Module({
  providers: [PdfRendererService, DocumentTemplateRepository],
  exports: [PdfRendererService, DocumentTemplateRepository],
})
export class DocumentGenerationModule {}
