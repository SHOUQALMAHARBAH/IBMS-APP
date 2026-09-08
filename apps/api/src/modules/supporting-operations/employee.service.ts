import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AccessDeprovisioningChecklist,
  Employee,
  SecurityAwarenessTraining,
} from '@ibms/db';
import { EmployeeRepository } from '../../repositories/employee.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { EncryptionService } from '../security/encryption.service';
import { SensitiveFieldRevealService } from '../security/sensitive-field-reveal.service';
import {
  encryptEntityFields,
  decryptEntityFields,
} from '../security/encrypted-fields';
import { SlaTimerService } from '../sla/sla-timer.service';
import { SessionService } from '../auth/services/session.service';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import { composeFullName } from '../../common/person-name.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateEmployeeDto,
  RevealEmployeeFieldDto,
} from './dto/create-employee.dto';
import type { CreateTrainingDto } from './dto/create-training.dto';
import type { UpdateDeprovisioningChecklistDto } from './dto/update-deprovisioning-checklist.dto';
import {
  isDeprovisioningChecklistFullyDone,
  toEmployeeListRow,
  toMaskedEmployee,
  type EmployeeDetail,
  type EmployeeListRow,
  type MaskedEmployee,
} from './employee.config';

const TERMINATION_SLA_WORKFLOW = 'termination_access_revocation';

/** Process 66 — Human Resources (backlog Part C #66, Domain H). See
 * `employee.config.ts` for the two backlog checkboxes this covers and
 * `ibms-brain/meta/context/employee-onboarding.md` for why `terminate()` is
 * the first real caller of the ALREADY-registered `termination_access_
 * revocation` SLA entry. */
@Injectable()
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    private readonly employees: EmployeeRepository,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly reveal: SensitiveFieldRevealService,
    private readonly slaTimers: SlaTimerService,
    private readonly sessions: SessionService,
  ) {}

  async create(
    dto: CreateEmployeeDto,
    actorUserId: string,
  ): Promise<MaskedEmployee> {
    const hireDate = parseHistoricalInstant(dto.hireDate, 'hireDate');
    const confidentialityAgreementSignedAt =
      dto.confidentialityAgreementSignedAt
        ? parseHistoricalInstant(
            dto.confidentialityAgreementSignedAt,
            'confidentialityAgreementSignedAt',
          )
        : undefined;
    const backgroundCheckCompletedAt = dto.backgroundCheckCompletedAt
      ? parseHistoricalInstant(
          dto.backgroundCheckCompletedAt,
          'backgroundCheckCompletedAt',
        )
      : undefined;

    if (dto.userId) {
      const user = await this.employees.findUserById(dto.userId);
      if (!user) throw new NotFoundException('User not found');
      if (user.employeeId) {
        throw new ConflictException(
          'This user account is already linked to another employee record',
        );
      }
    }

    const id = randomUUID();
    const encrypted = await encryptEntityFields(
      this.encryption,
      'Employee',
      { nationalIdEnc: dto.nationalId },
      { userId: actorUserId, entityType: 'Employee', entityId: id },
    );

    // Part F item #4 — an Employee is always a real individual, so the 4
    // national-ID-convention parts always apply.
    const fullName = composeFullName({
      givenName: dto.givenName,
      fatherName: dto.fatherName,
      grandfatherName: dto.grandfatherName,
      familyName: dto.familyName,
    });

    const employee = await this.employees.create({
      id,
      fullName,
      givenName: dto.givenName,
      fatherName: dto.fatherName,
      grandfatherName: dto.grandfatherName,
      familyName: dto.familyName,
      nationalIdEnc: encrypted.nationalIdEnc,
      position: dto.position,
      hireDate,
      licensedRole: dto.licensedRole,
      confidentialityAgreementSignedAt,
      backgroundCheckCompletedAt,
    });

    if (dto.userId) {
      await this.employees.linkUser(employee.id, dto.userId);
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Employee',
      entityId: employee.id,
      afterValue: {
        fullName: employee.fullName,
        position: employee.position,
        licensedRole: employee.licensedRole,
        linkedUserId: dto.userId ?? null,
      },
    });

    return this.toMasked(employee, actorUserId);
  }

  list(): Promise<EmployeeListRow[]> {
    return this.employees
      .findMany()
      .then((rows) => rows.map(toEmployeeListRow));
  }

  async get(id: string, actorUserId: string): Promise<EmployeeDetail> {
    const employee = await this.employees.findByIdWithRelations(id);
    if (!employee) throw new NotFoundException('Employee not found');
    const masked = await this.toMasked(employee, actorUserId);
    return {
      ...masked,
      trainings: employee.trainings,
      deprovisioningChecklist: employee.deprovisioningChecklist,
    };
  }

  async revealField(
    id: string,
    dto: RevealEmployeeFieldDto,
    actor: AuthenticatedUser,
  ): Promise<{ field: string; value: string }> {
    const employee = await this.employees.findById(id);
    if (!employee) throw new NotFoundException('Employee not found');
    const value = await this.reveal.reveal({
      userId: actor.id,
      entityType: 'Employee',
      entityId: id,
      field: dto.field,
      encryptedValue: employee.nationalIdEnc,
      reason: dto.reason,
    });
    return { field: dto.field, value };
  }

  async recordTraining(
    employeeId: string,
    dto: CreateTrainingDto,
    actorUserId: string,
  ): Promise<SecurityAwarenessTraining> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) throw new NotFoundException('Employee not found');

    let dueAt: Date | undefined;
    if (dto.dueAt) {
      dueAt = new Date(dto.dueAt);
      if (Number.isNaN(dueAt.getTime())) {
        throw new BadRequestException('dueAt is not a valid date');
      }
    }
    const completedAt = dto.completedAt
      ? parseHistoricalInstant(dto.completedAt, 'completedAt')
      : undefined;

    const training = await this.employees.createTraining({
      employeeId,
      trainingName: dto.trainingName,
      dueAt,
      completedAt,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'SecurityAwarenessTraining',
      entityId: training.id,
      afterValue: {
        employeeId,
        trainingName: training.trainingName,
        dueAt: training.dueAt?.toISOString() ?? null,
        completedAt: training.completedAt?.toISOString() ?? null,
      },
    });

    return training;
  }

  async completeTraining(
    employeeId: string,
    trainingId: string,
    actorUserId: string,
  ): Promise<SecurityAwarenessTraining> {
    const completedAt = new Date();
    const training = await this.employees.completeTraining(
      trainingId,
      employeeId,
      completedAt,
    );
    if (!training) {
      const existing = await this.employees.findTrainingById(trainingId);
      if (!existing || existing.employeeId !== employeeId) {
        throw new NotFoundException('Training record not found');
      }
      throw new ConflictException('This training is already marked complete');
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'SecurityAwarenessTraining',
      entityId: training.id,
      afterValue: { completedAt: completedAt.toISOString() },
    });

    return training;
  }

  /** The "employment-status change" that triggers de-provisioning
   * (`AccessDeprovisioningChecklist`'s own schema doc comment). Gated by
   * `deprovisioning.execute` (System Security Administrator ONLY), not the
   * broader `employee.manage` — terminating IS the trigger, so it sits
   * behind the same narrow permission as executing the checklist itself. */
  async terminate(
    employeeId: string,
    actorUserId: string,
  ): Promise<AccessDeprovisioningChecklist> {
    const existing = await this.employees.findById(employeeId);
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.terminationDate) {
      throw new ConflictException('Employee is already terminated');
    }

    const terminationDate = new Date();
    const result = await this.employees.terminate(employeeId, terminationDate);
    if (!result) {
      // Lost a genuine concurrent race — race-safe-invariants.md.
      throw new ConflictException('Employee is already terminated');
    }
    const { employee, checklist } = result;

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: employee.id,
      afterValue: { terminationDate: terminationDate.toISOString() },
    });
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'AccessDeprovisioningChecklist',
      entityId: checklist.id,
      afterValue: {
        employeeId,
        triggeredAt: terminationDate.toISOString(),
      },
    });

    // pdpl-sla-timers.md: "Termination access revocation (M05) | Same
    // business day | Critical alert to IT management if still open after
    // 24h" — already a registered SLA_REGISTRY entry with zero prior
    // caller. This is its first.
    await this.slaTimers.startTimer({
      entityType: 'AccessDeprovisioningChecklist',
      entityId: checklist.id,
      workflowName: TERMINATION_SLA_WORKFLOW,
      dueAt: terminationDate,
      actorUserId,
    });

    return checklist;
  }

  /** Ticks one or more checklist sub-items. `systemAccessRevoked: true` has
   * a REAL effect, not just a timestamp — if the employee has a linked
   * User account, it is deactivated and every live session killed
   * immediately (PRIV-STD-02 / PRIV-SOP-01/02/03), not deferred to the
   * checklist's eventual `completedAt`. */
  async updateChecklist(
    employeeId: string,
    dto: UpdateDeprovisioningChecklistDto,
    actorUserId: string,
  ): Promise<AccessDeprovisioningChecklist> {
    const checklist =
      await this.employees.findChecklistByEmployeeId(employeeId);
    if (!checklist) {
      throw new NotFoundException(
        'No de-provisioning checklist exists for this employee — has termination been recorded?',
      );
    }
    if (checklist.completedAt) {
      throw new ConflictException('This checklist is already complete');
    }

    const now = new Date();
    const update: {
      systemAccessRevokedAt?: Date;
      physicalAccessRevokedAt?: Date;
      deviceReturnedAt?: Date;
      knowledgeTransferDoneAt?: Date;
    } = {};
    if (dto.systemAccessRevoked && !checklist.systemAccessRevokedAt) {
      update.systemAccessRevokedAt = now;
    }
    if (dto.physicalAccessRevoked && !checklist.physicalAccessRevokedAt) {
      update.physicalAccessRevokedAt = now;
    }
    if (dto.deviceReturned && !checklist.deviceReturnedAt) {
      update.deviceReturnedAt = now;
    }
    if (dto.knowledgeTransferDone && !checklist.knowledgeTransferDoneAt) {
      update.knowledgeTransferDoneAt = now;
    }

    if (Object.keys(update).length === 0) {
      return checklist;
    }

    const updated = await this.employees.updateChecklist(checklist.id, update);

    if (update.systemAccessRevokedAt) {
      const user = await this.employees.findUserByEmployeeId(employeeId);
      if (user) {
        await this.employees.deactivateUser(user.id);
        await this.sessions.revokeAllForUser(user.id, 'admin_revoked');
      }
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'AccessDeprovisioningChecklist',
      entityId: checklist.id,
      afterValue: Object.fromEntries(
        Object.entries(update).map(([k, v]) => [k, v.toISOString()]),
      ),
    });

    return updated;
  }

  async completeChecklist(
    employeeId: string,
    actorUserId: string,
  ): Promise<AccessDeprovisioningChecklist> {
    const checklist =
      await this.employees.findChecklistByEmployeeId(employeeId);
    if (!checklist) {
      throw new NotFoundException(
        'No de-provisioning checklist exists for this employee',
      );
    }
    if (!isDeprovisioningChecklistFullyDone(checklist)) {
      throw new BadRequestException(
        'Every checklist item (system access, physical access, device return, knowledge transfer) must be recorded before the checklist can be completed',
      );
    }

    const completedAt = new Date();
    const updated = await this.employees.completeChecklist(
      checklist.id,
      completedAt,
    );
    if (!updated) {
      throw new ConflictException('This checklist is already complete');
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'AccessDeprovisioningChecklist',
      entityId: checklist.id,
      afterValue: { completedAt: completedAt.toISOString() },
    });

    await this.slaTimers.resolve({
      entityType: 'AccessDeprovisioningChecklist',
      entityId: checklist.id,
      workflowName: TERMINATION_SLA_WORKFLOW,
      actorUserId,
    });

    return updated;
  }

  /** Decrypts and masks the one `-- ENCRYPT` field for API responses — the
   * `CustomerService.toMasked` shape. `EncryptionService.decrypt()` itself
   * logs an `isSensitiveDataAccess` audit row per call (Part 10.3). */
  private async toMasked(
    employee: Employee,
    actorUserId: string,
  ): Promise<MaskedEmployee> {
    const decrypted = await decryptEntityFields(
      this.encryption,
      'Employee',
      { nationalIdEnc: employee.nationalIdEnc },
      { userId: actorUserId, entityType: 'Employee', entityId: employee.id },
    );
    return toMaskedEmployee(
      employee,
      this.reveal.mask(decrypted.nationalIdEnc),
    );
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Employee audit (${input.action} ${input.entityType}:${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
