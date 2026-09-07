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

  /** Links an existing `User` account to this employee — the FK #61 relies
   * on. Caller must have already confirmed the user has no employeeId set
   * (a plain FK update, not a race-guarded one — HR onboarding is a rare,
   * low-concurrency action with a human on both ends). */
  linkUser(employeeId: string, userId: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { employeeId },
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
