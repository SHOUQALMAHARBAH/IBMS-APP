import { Injectable } from '@nestjs/common';
import type { DocumentTemplate } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** `DocumentTemplate` (Part 11.2) was schema-only before Part F item #7 —
 * no repository/service ever read or wrote it at runtime; only the 4
 * `proposal_form_*` rows (packages/db/prisma/seed-data/document-templates.ts)
 * were ever seeded. `templateType` has NO unique constraint (a future
 * version-history use might want more than one row per type — the seed
 * script's own `ensureDocumentTemplates()` comment) — `findFirst`, same
 * "first matching row wins" convention the seed script already uses, not a
 * new one invented here. */
@Injectable()
export class DocumentTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByType(templateType: string): Promise<DocumentTemplate | null> {
    return this.prisma.client.documentTemplate.findFirst({
      where: { templateType },
    });
  }
}
