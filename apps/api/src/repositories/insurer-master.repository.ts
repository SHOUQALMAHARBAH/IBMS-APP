import { Injectable } from '@nestjs/common';
import { Prisma, type InsurerFormFieldType } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const TEMPLATE_INCLUDE = {
  fields: { orderBy: { displayOrder: 'asc' } },
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
    insuranceLine?: string,
  ): Promise<FormTemplateWithFields[]> {
    return this.prisma.client.insurerFormTemplate.findMany({
      where: {
        insurerMasterId,
        ...(insuranceLine === undefined
          ? {}
          : { insuranceLine: { equals: insuranceLine, mode: 'insensitive' } }),
      },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ insuranceLine: 'asc' }, { version: 'desc' }],
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
    insuranceLine: string;
    sourceDocumentRef: string | null;
    fields: FormFieldRow[];
  }): Promise<FormTemplateWithFields> {
    const ATTEMPTS = 5;
    for (let attempt = 1; ; attempt += 1) {
      const latest = await this.prisma.client.insurerFormTemplate.findFirst({
        where: {
          insurerMasterId: input.insurerMasterId,
          insuranceLine: input.insuranceLine,
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      try {
        return await this.prisma.client.insurerFormTemplate.create({
          data: {
            insurerMasterId: input.insurerMasterId,
            insuranceLine: input.insuranceLine,
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
