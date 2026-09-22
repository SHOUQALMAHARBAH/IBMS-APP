import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Q9 — an office's OWN mapped submission forms.
 *
 * The tenant-scoped sibling of `InsurerMasterRepository`'s template methods. Everything here
 * goes through `this.prisma.client`, the SCOPED client, so every read is filtered to the
 * caller's office by `applyTenantScope` and every write is stamped with it — which is why no
 * method below takes an `organizationId` and none may start doing so.
 *
 * The boundary is not this file's discipline, though: `OfficeInsurerFormTemplate` and
 * `OfficeInsurerFormField` both carry RLS policies, and the composite FKs
 * `(insurerId, organizationId)` / `(officeInsuranceLineId, organizationId)` /
 * `(templateId, organizationId)` make a cross-office row fail to INSERT. A raw query that
 * forgot the filter returns nothing; a write that crossed offices is refused by the database.
 */

/** What a caller needs to render a mapped form. */
const OFFICE_FORM_TEMPLATE_INCLUDE = {
  insuranceLine: {
    select: { id: true, code: true, nameEn: true, nameAr: true },
  },
  officeInsuranceLine: {
    select: { id: true, nameEn: true, nameAr: true },
  },
  fields: { orderBy: { displayOrder: 'asc' } },
} as const satisfies Prisma.OfficeInsurerFormTemplateInclude;

export type OfficeFormTemplateWithFields =
  Prisma.OfficeInsurerFormTemplateGetPayload<{
    include: typeof OFFICE_FORM_TEMPLATE_INCLUDE;
  }>;

/** Which line a form is for, as the caller named it. Exactly one, mirroring the CHECK. */
export type OfficeFormLineRef =
  | { kind: 'STANDARD'; insuranceLineId: string }
  | { kind: 'OFFICE'; officeInsuranceLineId: string };

@Injectable()
export class OfficeInsurerFormRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * This office's own templates for one insurer, newest version of each line first.
   *
   * Ordered `version desc` within the line ordering so `[0]` of any line's group is the one to
   * submit against — the same convention the global registry uses, kept identical on purpose so
   * a reader does not have to hold two rules.
   */
  listTemplates(
    insurerId: string,
    line?: OfficeFormLineRef,
  ): Promise<OfficeFormTemplateWithFields[]> {
    return this.prisma.client.officeInsurerFormTemplate.findMany({
      where: { insurerId, ...whereLine(line) },
      include: OFFICE_FORM_TEMPLATE_INCLUDE,
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** The newest version this office holds for one insurer and one line, or null. */
  async findCurrent(
    insurerId: string,
    line: OfficeFormLineRef,
  ): Promise<OfficeFormTemplateWithFields | null> {
    return this.prisma.client.officeInsurerFormTemplate.findFirst({
      where: { insurerId, ...whereLine(line) },
      include: OFFICE_FORM_TEMPLATE_INCLUDE,
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Records the next version of a mapping, fields and all, in ONE transaction.
   *
   * The version is read inside the transaction and the insert re-asserts it, so two
   * administrators mapping the same insurer+line concurrently cannot both write version 2:
   * the unique index refuses the second, and it surfaces as a P2002 the service turns into a
   * 409 rather than a 500. This is the `race-safe-invariants` rule applied — "the next version"
   * is a database invariant, not something a reader remembers to check.
   */
  async createNextVersion(input: {
    insurerId: string;
    line: OfficeFormLineRef;
    sourceDocumentRef: string | null;
    createdByUserId: string;
    fields: {
      fieldKey: string;
      labelEn: string;
      labelAr: string | null;
      dataType: OfficeFormTemplateWithFields['fields'][number]['dataType'];
      isRequired: boolean;
      options: string[];
      displayOrder: number;
    }[];
  }): Promise<OfficeFormTemplateWithFields> {
    return this.prisma.client.$transaction(async (tx) => {
      const latest = await tx.officeInsurerFormTemplate.findFirst({
        where: { insurerId: input.insurerId, ...whereLine(input.line) },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.officeInsurerFormTemplate.create({
        data: {
          insurerId: input.insurerId,
          ...whereLine(input.line),
          version: (latest?.version ?? 0) + 1,
          sourceDocumentRef: input.sourceDocumentRef,
          createdByUserId: input.createdByUserId,
          // Nested, so a template never exists without its fields. The scoped client stamps
          // `organizationId` on the children too, which is what the composite
          // `(templateId, organizationId)` FK then checks rather than trusts.
          fields: { create: input.fields },
        },
        include: OFFICE_FORM_TEMPLATE_INCLUDE,
      });
    });
  }
}

/**
 * The line reference as a `where`/`data` fragment.
 *
 * One function used by BOTH the reads and the write, deliberately: the column a query filters
 * on and the column a write fills must be the same one, and two places deciding that
 * independently is how a form gets stored against the catalogue line and looked up against the
 * office line. Undefined for "no line filter" — omitted from `where` entirely rather than
 * matched as NULL, which would mean "templates for no line" and return nothing.
 */
function whereLine(line?: OfficeFormLineRef) {
  if (line === undefined) return {};
  return line.kind === 'STANDARD'
    ? { insuranceLineId: line.insuranceLineId }
    : { officeInsuranceLineId: line.officeInsuranceLineId };
}
