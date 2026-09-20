import { Injectable } from '@nestjs/common';
import { Prisma, type InsuranceLineCategory } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The insurance-line vocabulary — the managed standard list and an office's own
 * additions.
 *
 * Two tables on purpose, and the asymmetry is the whole design:
 *
 *  - `InsuranceLine` is GLOBAL and this repository has **no write method for it**.
 *    Not "a write method nobody calls" — none exists, so there is no code path to
 *    audit, guard or accidentally expose. The 32 rows arrive from `prisma/seed.ts`
 *    and change only in a release, which is what keeps the permission-grid invariant
 *    (no code has an effect outside the granting office) true without copying the
 *    list into every office.
 *  - `OfficeInsuranceLine` is tenant-scoped like any other table, so every read and
 *    write below is filtered by `tenantScopeExtension` and backed by RLS. An
 *    addition one office makes is invisible to another; the directory is what
 *    aggregates them later, by canonical name.
 */

/** What a caller needs to render a line in either language. */
export const INSURANCE_LINE_SELECT = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  category: true,
  displayOrder: true,
} as const satisfies Prisma.InsuranceLineSelect;

export const OFFICE_INSURANCE_LINE_SELECT = {
  id: true,
  nameEn: true,
  nameAr: true,
  category: true,
  canonicalEn: true,
  canonicalAr: true,
  createdAt: true,
} as const satisfies Prisma.OfficeInsuranceLineSelect;

export type StandardLineRow = Prisma.InsuranceLineGetPayload<{
  select: typeof INSURANCE_LINE_SELECT;
}>;
export type OfficeLineRow = Prisma.OfficeInsuranceLineGetPayload<{
  select: typeof OFFICE_INSURANCE_LINE_SELECT;
}>;

@Injectable()
export class InsuranceLineRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The standard 32, in the order the market names them. */
  listStandard(): Promise<StandardLineRow[]> {
    return this.prisma.client.insuranceLine.findMany({
      select: INSURANCE_LINE_SELECT,
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
    });
  }

  /** This office's own additions, newest last so they read as an appendix to the
   *  standard list rather than jumping to the top of a picker. */
  listOfficeAdditions(): Promise<OfficeLineRow[]> {
    return this.prisma.client.officeInsuranceLine.findMany({
      select: OFFICE_INSURANCE_LINE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  findStandardByIds(ids: readonly string[]): Promise<StandardLineRow[]> {
    return this.prisma.client.insuranceLine.findMany({
      where: { id: { in: [...ids] } },
      select: INSURANCE_LINE_SELECT,
    });
  }

  findOfficeByIds(ids: readonly string[]): Promise<OfficeLineRow[]> {
    return this.prisma.client.officeInsuranceLine.findMany({
      where: { id: { in: [...ids] } },
      select: OFFICE_INSURANCE_LINE_SELECT,
    });
  }

  findOfficeLineById(id: string): Promise<OfficeLineRow | null> {
    return this.prisma.client.officeInsuranceLine.findUnique({
      where: { id },
      select: OFFICE_INSURANCE_LINE_SELECT,
    });
  }

  createOfficeLine(input: {
    nameEn: string;
    nameAr: string;
    category: InsuranceLineCategory;
    canonicalEn: string;
    canonicalAr: string;
    createdByUserId: string;
  }): Promise<OfficeLineRow> {
    // No `organizationId`: the extension stamps it. See `insurer.repository.ts`.
    return this.prisma.client.officeInsuranceLine.create({
      data: input,
      select: OFFICE_INSURANCE_LINE_SELECT,
    });
  }

  updateOfficeLine(
    id: string,
    patch: {
      nameEn?: string;
      nameAr?: string;
      category?: InsuranceLineCategory;
      canonicalEn?: string;
      canonicalAr?: string;
    },
  ): Promise<OfficeLineRow> {
    return this.prisma.client.officeInsuranceLine.update({
      where: { id },
      data: patch,
      select: OFFICE_INSURANCE_LINE_SELECT,
    });
  }

  /** How many insurers already say they offer this office-added line. Read before a
   *  rename only to report it; a rename is allowed either way, since the line is the
   *  same line under a corrected name. */
  countInsurersOffering(officeInsuranceLineId: string): Promise<number> {
    return this.prisma.client.insurerOfferedLine.count({
      where: { officeInsuranceLineId },
    });
  }
}
