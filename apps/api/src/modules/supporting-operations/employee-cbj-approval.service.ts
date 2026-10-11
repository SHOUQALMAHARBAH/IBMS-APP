import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { EmployeeRepository } from '../../repositories/employee.repository';
import { EmployeeCbjApprovalRepository } from '../../repositories/employee-cbj-approval.repository';
import { BrokerLicenseScopeRepository } from '../../repositories/broker-license-scope.repository';
import {
  approvalCounts,
  approvedTypes,
  type CbjApprovalView,
} from './employee-cbj-approval.config';
import type { SetCbjApprovalDto } from './dto/set-cbj-approval.dto';
import type { AddCbjApprovalBranchDto } from './dto/add-cbj-approval-branch.dto';
import { isCalendarDate } from '../../common/is-calendar-date.validator';

/**
 * MODULE 0 ITEM (g) — recording that the CBJ approved one person to act for this broker.
 *
 * ## It is on the PERSON, and that is a correction to the brief
 *
 * The item said "a marker on the user". It is on `Employee` because the CBJ approves a natural
 * person, item (f) counts approved PERSONS, an approved broker may hold no login at all, and this
 * system already has a `User` with no `Employee` behind it. On `User` a login would have become a
 * precondition of CBJ approval, which it is not.
 *
 * ## It is NOT an authorization input
 *
 * Nothing here is read by a permission decision, and `employee-cbj-approval.guard.spec.ts` fails if
 * that changes. Item (h) is where scope enters the authorization path, on the ROLE.
 *
 * ## Gated on `employee.update`, with no new permission code
 *
 * Recording a person's CBJ approval is a correction to their record, which is exactly what
 * `employee.update` already governs — and the holders are already the right ones. A new code would
 * have meant five regenerations and a twelfth module panel row for a capability nobody asked to
 * separate.
 */
@Injectable()
export class EmployeeCbjApprovalService {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly approvals: EmployeeCbjApprovalRepository,
    private readonly lines: BrokerLicenseScopeRepository,
    private readonly audit: AuditService,
  ) {}

  /** The approval as a screen reads it. A person with none reads as nulls and an empty list, never
   *  as a 404 — "this person holds no CBJ approval" is an answer, not a missing record. */
  async get(employeeId: string): Promise<CbjApprovalView> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');
    const branches = await this.approvals.findBranches(employeeId);
    return {
      status: employee.cbjApprovalStatus,
      approvalDate: employee.cbjApprovalDate
        ? employee.cbjApprovalDate.toISOString().slice(0, 10)
        : null,
      types: approvedTypes(branches),
      branches,
      countsTowardMinimumStaff:
        approvalCounts(employee.cbjApprovalStatus) &&
        employee.terminationDate === null,
    };
  }

  /**
   * Record, change or withdraw the approval.
   *
   * ## Clearing it is explicit, never implied by omission
   *
   * `status: null` clears the marker; an ABSENT status leaves it alone. Those have to be different,
   * because a PATCH that treated "field not sent" as "withdraw the approval" would silently empty
   * the staffing count on any request that only meant to correct the date.
   *
   * ## The date is refused when the status is absent, by the database AND here
   *
   * The CHECK refuses a date with no status, and so does this — with a message naming the problem,
   * because a 500 from a constraint tells the writer nothing about what to send instead.
   */
  async set(
    employeeId: string,
    dto: SetCbjApprovalDto,
    actorUserId: string,
  ): Promise<CbjApprovalView> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const status =
      dto.status === undefined ? employee.cbjApprovalStatus : dto.status;

    let approvalDate: Date | null;
    if (dto.approvalDate === undefined) {
      approvalDate = employee.cbjApprovalDate;
    } else if (dto.approvalDate === null) {
      approvalDate = null;
    } else {
      // A whole calendar day, round-tripped. `@Matches(/^\d{4}-\d{2}-\d{2}$/)` admits 2026-02-30,
      // which parses cleanly to 2 March — IMPROVEMENTS § 1.63, the defect that stored a date nobody
      // typed. The shared validator is the one form that catches all three non-dates.
      if (!isCalendarDate(dto.approvalDate)) {
        throw new UnprocessableEntityException(
          `approvalDate ${dto.approvalDate} is not a day that exists.`,
        );
      }
      approvalDate = new Date(`${dto.approvalDate}T00:00:00.000Z`);
    }

    if (approvalDate !== null && status === null) {
      throw new UnprocessableEntityException(
        'A CBJ approval date cannot be recorded without a status. Give the approval a status ' +
          '(current, suspended or cancelled), or clear the date as well.',
      );
    }

    // Clearing the status leaves branches behind that describe an approval nobody holds, so they go
    // with it. Done BEFORE the status write: a failure part-way then leaves the approval intact
    // with fewer branches, which a reader can see and correct, rather than a statusless person
    // still carrying approved branches, which reads as a half-recorded approval.
    if (status === null && employee.cbjApprovalStatus !== null) {
      const existing = await this.approvals.findBranches(employeeId);
      for (const branch of existing) {
        await this.approvals.removeBranch(branch.id, employeeId);
      }
    }

    await this.approvals.setApproval(employeeId, { status, approvalDate });

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: employeeId,
      // The national ID is never in either value, and nothing about this act needs it. Both sides
      // are recorded because "approved on this date" becoming "suspended" is the whole point of
      // keeping a status rather than a boolean.
      beforeValue: {
        cbjApprovalStatus: employee.cbjApprovalStatus,
        cbjApprovalDate: employee.cbjApprovalDate?.toISOString() ?? null,
      },
      afterValue: {
        cbjApprovalStatus: status,
        cbjApprovalDate: approvalDate?.toISOString() ?? null,
      },
    });

    return this.get(employeeId);
  }

  /**
   * Add one approved branch.
   *
   * A branch may only be added to a person who HAS an approval: a branch on a statusless person is
   * a scope with nothing to scope, and it would be counted by the derivation as a type this person
   * is approved for.
   */
  async addBranch(
    employeeId: string,
    dto: AddCbjApprovalBranchDto,
    actorUserId: string,
  ): Promise<CbjApprovalView> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.cbjApprovalStatus === null) {
      throw new UnprocessableEntityException(
        'This person holds no CBJ approval, so there is nothing for a branch to belong to. ' +
          'Record the approval first.',
      );
    }

    // Exactly one catalogue, checked HERE and not in the DTO: `@IsOptional()` installs a condition
    // that skips every validator on its property when the value is absent, so a class-level
    // constraint on either optional field would be skipped in precisely the "neither" case it
    // exists for. Item (e) hit this and the same reasoning applies unchanged.
    const named = [dto.insuranceLineId, dto.officeInsuranceLineId].filter(
      (v) => v != null,
    );
    if (named.length !== 1) {
      throw new UnprocessableEntityException(
        'Name exactly one branch: either insuranceLineId (a standard catalogue line) or ' +
          'officeInsuranceLineId (one of this office’s own lines).',
      );
    }

    // Reusing item (e)'s catalogue read rather than writing a second one: it is the same question
    // (what category is this branch?) against the same two catalogues, and a second copy would be a
    // second chance to resolve an office line without the tenant scope.
    const category = await this.lines.findCandidateCategory(
      dto.insuranceLineId ?? null,
      dto.officeInsuranceLineId ?? null,
    );
    if (!category) {
      throw new NotFoundException(
        'That insurance line does not exist in this office.',
      );
    }

    /*
     * THE SAME BRANCH TWICE IS A 409, NOT A 500.
     *
     * The two partial uniques are the control, and without this mapping the second attempt would be
     * an unhandled P2002 — there is no global Prisma exception filter in this api, so a route whose
     * service does not map it answers 500 and tells the writer the system is broken when they have
     * simply added a branch that is already there. The same defect the holiday calendar shipped once
     * (IMPROVEMENTS § 1.57).
     */
    let created: { id: string };
    try {
      created = await this.approvals.addBranch({
        employeeId,
        insuranceLineId: dto.insuranceLineId ?? null,
        officeInsuranceLineId: dto.officeInsuranceLineId ?? null,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This person’s CBJ approval already covers that branch.',
        );
      }
      throw err;
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'EmployeeCbjApprovalBranch',
      entityId: created.id,
      afterValue: {
        employeeId,
        insuranceLineId: dto.insuranceLineId ?? null,
        officeInsuranceLineId: dto.officeInsuranceLineId ?? null,
        category,
      },
    });

    return this.get(employeeId);
  }

  async removeBranch(
    employeeId: string,
    branchId: string,
    actorUserId: string,
  ): Promise<CbjApprovalView> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    const removed = await this.approvals.removeBranch(branchId, employeeId);
    if (removed.count === 0) {
      // A branch belonging to somebody else reads as ABSENT rather than forbidden — the same 404
      // this repository gives a detail page addressed by another office's id, and for the same
      // reason: a 403 would confirm the row exists.
      throw new NotFoundException(
        'That approved branch does not belong to this person.',
      );
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'DELETE',
      entityType: 'EmployeeCbjApprovalBranch',
      entityId: branchId,
      beforeValue: { employeeId },
    });

    return this.get(employeeId);
  }
}
