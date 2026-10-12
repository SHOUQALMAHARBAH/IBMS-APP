import { Injectable } from '@nestjs/common';
import type { InsuranceLineCategory, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** One licensed branch, with the catalogue facts the rules and the screen need. */
export interface ScopeLineRow {
  id: string;
  brokerLicenseId: string;
  insuranceLineId: string | null;
  officeInsuranceLineId: string | null;
  /** Derived from whichever catalogue the branch came from — never stored on the scope row. */
  category: InsuranceLineCategory;
  nameEn: string;
  nameAr: string;
  /** The standard catalogue's stable code, or null for an office's own line. */
  code: string | null;
}

export interface AddScopeLineInput {
  brokerLicenseId: string;
  insuranceLineId: string | null;
  officeInsuranceLineId: string | null;
}

/**
 * MODULE 0 ITEM (e) — the branches a licence term covers.
 *
 * Scoping is not done by hand: `BrokerLicenseScopeLine` carries `organizationId`, so
 * `tenantScopeExtension` filters every query here by the caller's office and the composite tenant
 * FK makes a row naming another office's bespoke line unINSERTable in the first place.
 *
 * ## The read flattens TWO catalogues into one shape
 *
 * A branch is a row of either `InsuranceLine` (the 32 standard lines) or `OfficeInsuranceLine` (an
 * office's own). Both carry `category`, `nameEn` and `nameAr`, so the service and the screen should
 * not have to care which one a branch came from — only `code` differs, and it is null for an office
 * line because an office addition has no catalogue code.
 */
@Injectable()
export class BrokerLicenseScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForTerm(brokerLicenseId: string): Promise<ScopeLineRow[]> {
    const rows = await this.prisma.client.brokerLicenseScopeLine.findMany({
      where: { brokerLicenseId },
      include: {
        insuranceLine: {
          select: { code: true, nameEn: true, nameAr: true, category: true },
        },
        officeInsuranceLine: {
          select: { nameEn: true, nameAr: true, category: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((r) => {
      // Exactly one of the two is set — held by the `_exactly_one_line` CHECK, not by hope. The
      // fallback below exists only so a row that somehow violated it is LOUD rather than silently
      // contributing a wrong category to art. 4/a's branch arithmetic.
      const line = r.insuranceLine ?? r.officeInsuranceLine;
      if (!line) {
        throw new Error(
          `BrokerLicenseScopeLine ${r.id} names neither catalogue — the exactly-one-line CHECK has been violated or dropped.`,
        );
      }
      return {
        id: r.id,
        brokerLicenseId: r.brokerLicenseId,
        insuranceLineId: r.insuranceLineId,
        officeInsuranceLineId: r.officeInsuranceLineId,
        category: line.category,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        code: r.insuranceLine?.code ?? null,
      };
    });
  }

  /** The category of a branch BEFORE it is added, so art. 3/a can be decided without writing. */
  async findCandidateCategory(
    insuranceLineId: string | null,
    officeInsuranceLineId: string | null,
  ): Promise<InsuranceLineCategory | null> {
    if (insuranceLineId) {
      const line = await this.prisma.client.insuranceLine.findUnique({
        where: { id: insuranceLineId },
        select: { category: true },
      });
      return line?.category ?? null;
    }
    if (officeInsuranceLineId) {
      // Tenant-scoped by the extension, so another office's bespoke line reads as ABSENT rather
      // than as a line this office may license.
      const line = await this.prisma.client.officeInsuranceLine.findUnique({
        where: { id: officeInsuranceLineId },
        select: { category: true },
      });
      return line?.category ?? null;
    }
    return null;
  }

  addLine(input: AddScopeLineInput): Promise<{ id: string }> {
    return this.prisma.client.brokerLicenseScopeLine.create({
      data: {
        brokerLicenseId: input.brokerLicenseId,
        insuranceLineId: input.insuranceLineId,
        officeInsuranceLineId: input.officeInsuranceLineId,
      },
      select: { id: true },
    });
  }

  /** Status-conditional on the term, so an id from another term is a 0-row match rather than a
   *  cross-term delete. */
  removeLine(
    id: string,
    brokerLicenseId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.brokerLicenseScopeLine.deleteMany({
      where: { id, brokerLicenseId },
    });
  }
}
