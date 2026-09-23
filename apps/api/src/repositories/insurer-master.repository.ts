import { Injectable } from '@nestjs/common';
import { Prisma, type InsurerFormFieldType } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const TEMPLATE_INCLUDE = {
  fields: { orderBy: { displayOrder: 'asc' } },
  // The managed line, so the view can name it instead of echoing an opaque uuid. Global
  // catalogue only — see the schema comment on `InsurerFormTemplate.insuranceLineId` for why
  // an office's own line cannot be reached from a row every office reads.
  insuranceLine: {
    select: { id: true, code: true, nameEn: true, nameAr: true },
  },
} as const satisfies Prisma.InsurerFormTemplateInclude;

export type FormTemplateWithFields = Prisma.InsurerFormTemplateGetPayload<{
  include: typeof TEMPLATE_INCLUDE;
}>;

export interface FormFieldRow {
  fieldKey: string;
  labelEn: string;
  labelAr: string | null;
  dataType: InsurerFormFieldType;
  isRequired: boolean;
  options: string[];
  displayOrder: number;
}

/**
 * Part I §5 — the GLOBAL insurer master registry and the form mappings hanging
 * off it.
 *
 * Every model this repository touches is global: no `organizationId`, so
 * `tenantScopeExtension` leaves these queries unfiltered and no RLS policy
 * applies. That is deliberate and is the entire point of §5 — a form mapped
 * once by one office is immediately available, unmodified, to every other
 * office dealing with the same insurer. Anything that genuinely differs per
 * office lives on `Insurer`, which is scoped like any other table.
 */
@Injectable()
export class InsurerMasterRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMasters() {
    return this.prisma.client.insurerMaster.findMany({
      orderBy: { legalName: 'asc' },
    });
  }

  findMaster(id: string) {
    return this.prisma.client.insurerMaster.findUnique({ where: { id } });
  }

  listTemplates(
    insurerMasterId: string,
    insuranceLineId?: string,
  ): Promise<FormTemplateWithFields[]> {
    return this.prisma.client.insurerFormTemplate.findMany({
      where: {
        insurerMasterId,
        // An exact id match, replacing a case-INSENSITIVE string compare. That
        // `mode: 'insensitive'` was itself a symptom: it existed because the caller sent free
        // text and "Motor" had to find "motor". With a managed vocabulary the question has one
        // answer, and a filter that cannot half-match is a different guarantee, not a tidier
        // version of the same one.
        ...(insuranceLineId === undefined ? {} : { insuranceLineId }),
      },
      include: TEMPLATE_INCLUDE,
      // By the line's stable CODE, not its uuid: a uuid order is arbitrary and differs between
      // databases, so the list would come back in a different order on dev and in production
      // for no reason a reader could see.
      orderBy: [{ insuranceLine: { code: 'asc' } }, { version: 'desc' }],
    });
  }

  findTemplate(id: string): Promise<FormTemplateWithFields | null> {
    return this.prisma.client.insurerFormTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
  }

  /**
   * Records a new mapping for an insurer+line as the next version.
   *
   * The version is NOT allocated by reading the current maximum and trusting
   * it: that is a check-then-act, and two offices mapping the same form at the
   * same moment would both read the same maximum
   * (ibms-brain/meta/lex/race-safe-invariants.md). The
   * `@@unique([insurerMasterId, insuranceLine, version])` constraint is what
   * actually decides, and a losing writer retries against the new maximum
   * rather than silently overwriting the winner.
   */
  async createNextVersion(input: {
    insurerMasterId: string;
    insuranceLineId: string;
    sourceDocumentRef: string | null;
    fields: FormFieldRow[];
  }): Promise<FormTemplateWithFields> {
    const ATTEMPTS = 5;
    for (let attempt = 1; ; attempt += 1) {
      const latest = await this.prisma.client.insurerFormTemplate.findFirst({
        where: {
          insurerMasterId: input.insurerMasterId,
          insuranceLineId: input.insuranceLineId,
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      try {
        return await this.prisma.client.insurerFormTemplate.create({
          data: {
            insurerMasterId: input.insurerMasterId,
            insuranceLineId: input.insuranceLineId,
            version,
            sourceDocumentRef: input.sourceDocumentRef,
            fields: { create: input.fields },
          },
          include: TEMPLATE_INCLUDE,
        });
      } catch (error) {
        const lostTheRace =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!lostTheRace || attempt >= ATTEMPTS) throw error;
      }
    }
  }
}
