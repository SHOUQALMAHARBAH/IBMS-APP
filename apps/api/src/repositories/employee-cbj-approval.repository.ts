import { Injectable } from '@nestjs/common';
import type {
  CbjApprovalStatus,
  InsuranceLineCategory,
  Prisma,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** One approved branch, with the catalogue facts the rules and the screen need. */
export interface ApprovalBranchRow {
  id: string;
  employeeId: string;
  insuranceLineId: string | null;
  officeInsuranceLineId: string | null;
  /** Derived from whichever catalogue the branch came from — never stored on the approval row. */
  category: InsuranceLineCategory;
  nameEn: string;
  nameAr: string;
  /** The standard catalogue's stable code, or null for an office's own line. */
  code: string | null;
}

export interface AddApprovalBranchInput {
  employeeId: string;
  insuranceLineId: string | null;
  officeInsuranceLineId: string | null;
}

/**
 * MODULE 0 ITEM (g) — a person's CBJ approval and the branches it covers.
 *
 * Deliberately a SEPARATE repository from `EmployeeRepository` rather than four more methods on it:
 * `EmployeeRepository` is the HR record (names, national id, hire dates, deprovisioning), and this
 * is a regulatory marker that item (f)'s staffing rule and the licence screens read. Keeping them
 * apart is also what makes the "no permission decision reads this" guard easy to state — one file
 * to look for in the authorization path.
 *
 * Scoping is not done by hand: `EmployeeCbjApprovalBranch` carries `organizationId`, so
 * `tenantScopeExtension` filters every query here, and the composite tenant FK makes a branch naming
 * another office's bespoke line unINSERTable rather than merely unqueried.
 */
@Injectable()
export class EmployeeCbjApprovalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBranches(employeeId: string): Promise<ApprovalBranchRow[]> {
    const rows = await this.prisma.client.employeeCbjApprovalBranch.findMany({
      where: { employeeId },
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
      // throw exists so a row that somehow violated it is LOUD rather than silently contributing a
      // wrong category to the approved-types derivation.
      const line = r.insuranceLine ?? r.officeInsuranceLine;
      if (!line) {
        throw new Error(
          `EmployeeCbjApprovalBranch ${r.id} names neither catalogue — the exactly-one-line CHECK has been violated or dropped.`,
        );
      }
      return {
        id: r.id,
        employeeId: r.employeeId,
        insuranceLineId: r.insuranceLineId,
        officeInsuranceLineId: r.officeInsuranceLineId,
        category: line.category,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        code: r.insuranceLine?.code ?? null,
      };
    });
  }

  addBranch(input: AddApprovalBranchInput): Promise<{ id: string }> {
    return this.prisma.client.employeeCbjApprovalBranch.create({
      data: {
        employeeId: input.employeeId,
        insuranceLineId: input.insuranceLineId,
        officeInsuranceLineId: input.officeInsuranceLineId,
      },
      select: { id: true },
    });
  }

  /** Status-conditional on the person, so a branch id belonging to somebody else is a 0-row match
   *  rather than a delete against another person's approval. */
  removeBranch(id: string, employeeId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.employeeCbjApprovalBranch.deleteMany({
      where: { id, employeeId },
    });
  }

  setApproval(
    employeeId: string,
    data: { status: CbjApprovalStatus | null; approvalDate: Date | null },
  ): Promise<{ id: string }> {
    return this.prisma.client.employee.update({
      where: { id: employeeId },
      data: {
        cbjApprovalStatus: data.status,
        cbjApprovalDate: data.approvalDate,
      },
      select: { id: true },
    });
  }

  /**
   * How many people in this office hold a CURRENT CBJ approval — item (f)'s minimum-staff count.
   *
   * `terminationDate: null` is part of the question, not a refinement of it: a former employee's
   * approval row is kept as evidence (the FK is RESTRICT for that reason), and counting somebody who
   * has left would let an office satisfy a staffing minimum with a vacancy.
   *
   * Tenant-scoped by the extension, so this is always "in the caller's office".
   */
  countCurrentApprovals(): Promise<number> {
    return this.prisma.client.employee.count({
      where: { cbjApprovalStatus: 'CURRENT', terminationDate: null },
    });
  }
}
