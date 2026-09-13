import { Injectable } from '@nestjs/common';
import type {
  AccessDeprovisioningChecklist,
  Employee,
  SecurityAwarenessTraining,
  User,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateEmployeeInput {
  id: string;
  fullName: string;
  /** Jordanian national-ID-convention name parts (Part F item #4) — an
   * Employee is always a real individual, so these always apply. */
  givenName: string;
  fatherName?: string;
  grandfatherName?: string;
  familyName: string;
  nationalIdEnc: string;
  position?: string;
  /** Spec §4.1.2 — the org-chart department. Optional: an employee can be
   * recorded before HR has placed them, and a linked account's own
   * `departmentId` is adopted by `linkUser` when this is left unset. */
  departmentId?: string;
  hireDate: Date;
  licensedRole?: string;
  confidentialityAgreementSignedAt?: Date;
  backgroundCheckCompletedAt?: Date;
}

export type EmployeeWithRelations = Employee & {
  trainings: SecurityAwarenessTraining[];
  deprovisioningChecklist: AccessDeprovisioningChecklist | null;
};

export interface CreateTrainingInput {
  employeeId: string;
  trainingName: string;
  dueAt?: Date;
  completedAt?: Date;
}

/**
 * The outcome of `EmployeeRepository.linkUser`. A discriminated union rather
 * than a thrown error: the department rule is a repository-level invariant,
 * but which HTTP status each outcome deserves is the service's call.
 */
export type LinkUserResult =
  | {
      outcome: 'LINKED';
      user: User;
      /** True when the employee had no department and took the account's. */
      departmentAdoptedFromAccount: boolean;
    }
  | { outcome: 'USER_NOT_FOUND' }
  | { outcome: 'EMPLOYEE_NOT_FOUND' }
  | { outcome: 'ALREADY_LINKED' }
  | {
      outcome: 'DEPARTMENT_CONFLICT';
      employeeDepartmentId: string;
      userDepartmentId: string;
    };

export interface DeprovisioningChecklistUpdate {
  systemAccessRevokedAt?: Date;
  physicalAccessRevokedAt?: Date;
  deviceReturnedAt?: Date;
  knowledgeTransferDoneAt?: Date;
}

/**
 * Process 66 (backlog Part C #66, Domain H — opens Domain H) — Human
 * Resources. Owns `Employee` + its two child models (`SecurityAwarenessTraining`,
 * `AccessDeprovisioningChecklist`), all pre-existing in the core schema with
 * zero prior application code ever writing to them (the same "first real
 * consumer of a dormant model" shape as #58-65's own Domain G finds). Also
 * touches `User.employeeId` — the FK #61 (Employee Performance) needed but
 * nothing before this process ever set.
 */
@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateEmployeeInput): Promise<Employee> {
    return this.prisma.client.employee.create({ data: input });
  }

  findById(id: string): Promise<Employee | null> {
    return this.prisma.client.employee.findUnique({ where: { id } });
  }

  findByIdWithRelations(id: string): Promise<EmployeeWithRelations | null> {
    return this.prisma.client.employee.findUnique({
      where: { id },
      include: { trainings: true, deprovisioningChecklist: true },
    });
  }

  findMany(): Promise<Employee[]> {
    return this.prisma.client.employee.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Links an existing `User` account to this employee — the FK #61 relies on —
   * AND reconciles the two `departmentId` columns in the same transaction.
   *
   * Two columns can hold one person's department: `Employee.departmentId`
   * (spec §4.1.2, the org chart) and `User.departmentId` (§4.2.2, what the
   * admin picked when provisioning, which happens before an `Employee` row
   * usually exists). Linking is the one moment they meet, and until now it
   * copied neither and compared neither — so the day anything started writing
   * `Employee.departmentId`, the two could disagree permanently with nothing
   * to notice. The rule, read side in `common/department.util.ts`:
   *
   *   - employee has none, account has one  -> the employee ADOPTS it;
   *   - both set and equal                  -> nothing to do;
   *   - both set and DIFFERENT              -> refuse the link (the caller
   *     turns this into a 409). Silently picking a winner here is exactly the
   *     silent divergence this exists to prevent, and a human has to say which
   *     is right;
   *   - neither set                         -> nothing to do.
   *
   * One interactive transaction, the `terminate()` shape above (itself the
   * `retention-case.repository.ts` precedent) — a deliberate local exception
   * to this codebase's no-`$transaction` convention, needed because reading
   * both rows and writing one has to be atomic.
   *
   * The adopt step is a status-conditional write, not a check-then-act
   * (`race-safe-invariants.md`): it re-asserts `departmentId: null` in its own
   * `where`, so a concurrent writer that filled the column in between our read
   * and our write cannot be silently overwritten — a 0-row result sends us
   * back to re-read and re-decide rather than trusting what we read first.
   */
  linkUser(employeeId: string, userId: string): Promise<LinkUserResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { employeeId: true, departmentId: true },
      });
      if (!user) return { outcome: 'USER_NOT_FOUND' as const };
      if (user.employeeId) return { outcome: 'ALREADY_LINKED' as const };

      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { departmentId: true },
      });
      if (!employee) return { outcome: 'EMPLOYEE_NOT_FOUND' as const };

      let departmentAdoptedFromAccount = false;
      if (user.departmentId !== null) {
        if (
          employee.departmentId !== null &&
          employee.departmentId !== user.departmentId
        ) {
          return {
            outcome: 'DEPARTMENT_CONFLICT' as const,
            employeeDepartmentId: employee.departmentId,
            userDepartmentId: user.departmentId,
          };
        }
        if (employee.departmentId === null) {
          const adopted = await tx.employee.updateMany({
            where: { id: employeeId, departmentId: null },
            data: { departmentId: user.departmentId },
          });
          if (adopted.count === 0) {
            // Someone set it between our read and our write. Re-read and
            // apply the same rule to what is actually there now.
            const current = await tx.employee.findUniqueOrThrow({
              where: { id: employeeId },
              select: { departmentId: true },
            });
            if (current.departmentId !== user.departmentId) {
              return {
                outcome: 'DEPARTMENT_CONFLICT' as const,
                employeeDepartmentId: current.departmentId as string,
                userDepartmentId: user.departmentId,
              };
            }
          } else {
            departmentAdoptedFromAccount = true;
          }
        }
      }

      const linked = await tx.user.update({
        where: { id: userId },
        data: { employeeId },
      });
      return {
        outcome: 'LINKED' as const,
        user: linked,
        departmentAdoptedFromAccount,
      };
    });
  }

  findUserById(userId: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { id: userId } });
  }

  /** The reverse lookup — `User.employeeId` is the FK, so finding "the
   * account linked to this employee" is a `findUnique` on `User`, not a
   * relation load off `Employee` (which has no `userId` column of its
   * own). Used to actually disable login when `systemAccessRevoked` is
   * ticked on the de-provisioning checklist. */
  findUserByEmployeeId(employeeId: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { employeeId } });
  }

  deactivateUser(userId: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
  }

  createTraining(
    input: CreateTrainingInput,
  ): Promise<SecurityAwarenessTraining> {
    return this.prisma.client.securityAwarenessTraining.create({
      data: input,
    });
  }

  findTrainingById(id: string): Promise<SecurityAwarenessTraining | null> {
    return this.prisma.client.securityAwarenessTraining.findUnique({
      where: { id },
    });
  }

  /** Race-safe: only a training that belongs to `employeeId` and is not
   * already completed can be completed (race-safe-invariants.md — the
   * guard re-asserts BOTH the ownership and the not-yet-done condition, not
   * just the id). Returns `null` when the guard matched 0 rows. */
  async completeTraining(
    trainingId: string,
    employeeId: string,
    completedAt: Date,
  ): Promise<SecurityAwarenessTraining | null> {
    const result =
      await this.prisma.client.securityAwarenessTraining.updateMany({
        where: { id: trainingId, employeeId, completedAt: null },
        data: { completedAt },
      });
    if (result.count === 0) return null;
    return this.findTrainingById(trainingId);
  }

  /**
   * The termination stamp + checklist creation, in ONE interactive
   * transaction (the `retention-case.repository.ts#escalateAndCreateRetentionCase`
   * shape — a deliberate local exception to this codebase's no-`$transaction`
   * convention). The guard re-asserts `terminationDate: null` so a second
   * concurrent termination attempt cannot open a second checklist for the
   * same employee (`AccessDeprovisioningChecklist.employeeId` is `@unique`
   * anyway, but the stamp guard means the SECOND caller gets a clean `null`
   * result instead of a raw unique-constraint error). Returns `null` when
   * this employee was already terminated.
   */
  terminate(
    employeeId: string,
    terminationDate: Date,
  ): Promise<{
    employee: Employee;
    checklist: AccessDeprovisioningChecklist;
  } | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const stamped = await tx.employee.updateMany({
        where: { id: employeeId, terminationDate: null },
        data: { terminationDate },
      });
      if (stamped.count === 0) return null;

      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      const checklist = await tx.accessDeprovisioningChecklist.create({
        data: { employeeId, triggeredAt: terminationDate },
      });
      return { employee, checklist };
    });
  }

  findChecklistById(id: string): Promise<AccessDeprovisioningChecklist | null> {
    return this.prisma.client.accessDeprovisioningChecklist.findUnique({
      where: { id },
    });
  }

  findChecklistByEmployeeId(
    employeeId: string,
  ): Promise<AccessDeprovisioningChecklist | null> {
    return this.prisma.client.accessDeprovisioningChecklist.findUnique({
      where: { employeeId },
    });
  }

  updateChecklist(
    id: string,
    update: DeprovisioningChecklistUpdate,
  ): Promise<AccessDeprovisioningChecklist> {
    return this.prisma.client.accessDeprovisioningChecklist.update({
      where: { id },
      data: update,
    });
  }

  /** Race-safe: only an open (`completedAt: null`) checklist can be
   * completed — guards against double-completion re-resolving the SLA
   * timer twice. Returns `null` when already completed. */
  async completeChecklist(
    id: string,
    completedAt: Date,
  ): Promise<AccessDeprovisioningChecklist | null> {
    const result =
      await this.prisma.client.accessDeprovisioningChecklist.updateMany({
        where: { id, completedAt: null },
        data: { completedAt },
      });
    if (result.count === 0) return null;
    return this.findChecklistById(id);
  }
}
