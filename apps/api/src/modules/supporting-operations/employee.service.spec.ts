import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeService } from './employee.service';
import type { EmployeeRepository } from '../../repositories/employee.repository';
import type { AuditService } from '../audit/audit.service';
import type { EncryptionService } from '../security/encryption.service';
import type { SensitiveFieldRevealService } from '../security/sensitive-field-reveal.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { SessionService } from '../auth/services/session.service';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { CreateTrainingDto } from './dto/create-training.dto';

function baseEmployee(over: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    fullName: 'Jane Doe',
    nationalIdEnc: 'enc:9999999999',
    position: 'Placement Officer',
    hireDate: new Date('2024-01-15T00:00:00.000Z'),
    terminationDate: null,
    licensedRole: 'CBJ Broker Rep',
    confidentialityAgreementSignedAt: null,
    backgroundCheckCompletedAt: null,
    createdAt: new Date('2024-01-15T09:00:00.000Z'),
    updatedAt: new Date('2024-01-15T09:00:00.000Z'),
    ...over,
  };
}

function baseChecklist(over: Record<string, unknown> = {}) {
  return {
    id: 'chk-1',
    employeeId: 'emp-1',
    triggeredAt: new Date('2026-09-16T09:00:00.000Z'),
    systemAccessRevokedAt: null,
    physicalAccessRevokedAt: null,
    deviceReturnedAt: null,
    knowledgeTransferDoneAt: null,
    completedAt: null,
    ...over,
  };
}

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    findUserById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(baseEmployee()),
    linkUser: vi.fn().mockResolvedValue({ id: 'user-1', employeeId: 'emp-1' }),
    findById: vi.fn().mockResolvedValue(baseEmployee()),
    findByIdWithRelations: vi.fn().mockResolvedValue({
      ...baseEmployee(),
      trainings: [],
      deprovisioningChecklist: null,
    }),
    findMany: vi.fn().mockResolvedValue([baseEmployee()]),
    createTraining: vi.fn().mockResolvedValue({
      id: 'trn-1',
      employeeId: 'emp-1',
      trainingName: 'Phishing awareness',
      dueAt: null,
      completedAt: null,
    }),
    findTrainingById: vi.fn().mockResolvedValue(null),
    completeTraining: vi.fn().mockResolvedValue({
      id: 'trn-1',
      employeeId: 'emp-1',
      trainingName: 'Phishing awareness',
      dueAt: null,
      completedAt: new Date(),
    }),
    terminate: vi.fn().mockResolvedValue({
      employee: baseEmployee({ terminationDate: new Date() }),
      checklist: baseChecklist(),
    }),
    findChecklistByEmployeeId: vi.fn().mockResolvedValue(baseChecklist()),
    updateChecklist: vi
      .fn()
      .mockImplementation((_id: string, update: Record<string, unknown>) =>
        Promise.resolve(baseChecklist(update)),
      ),
    completeChecklist: vi
      .fn()
      .mockResolvedValue(baseChecklist({ completedAt: new Date() })),
    findUserByEmployeeId: vi.fn().mockResolvedValue(null),
    deactivateUser: vi
      .fn()
      .mockResolvedValue({ id: 'user-1', isActive: false }),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const encryption = {
    encrypt: vi
      .fn()
      .mockImplementation((_purpose: string, value: string) =>
        Promise.resolve(`enc:${value}`),
      ),
    decrypt: vi
      .fn()
      .mockImplementation((_purpose: string, value: string) =>
        Promise.resolve(String(value).replace(/^enc:/, '')),
      ),
  };
  const reveal = {
    mask: vi
      .fn()
      .mockImplementation((plaintext: string) => `masked:${plaintext}`),
    reveal: vi.fn().mockResolvedValue('9999999999'),
  };
  const slaTimers = {
    startTimer: vi.fn().mockResolvedValue([]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const sessions = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };

  const service = new EmployeeService(
    repo as unknown as EmployeeRepository,
    audit as unknown as AuditService,
    encryption as unknown as EncryptionService,
    reveal as unknown as SensitiveFieldRevealService,
    slaTimers as unknown as SlaTimerService,
    sessions as unknown as SessionService,
  );
  return { service, repo, audit, encryption, reveal, slaTimers, sessions };
}

const CREATE_DTO: CreateEmployeeDto = {
  givenName: 'Jane',
  familyName: 'Doe',
  nationalId: '9999999999',
  hireDate: '2024-01-15',
};

describe('EmployeeService.create', () => {
  it('encrypts the national id, creates the employee, and returns a masked view', async () => {
    const { service, repo, encryption, audit } = makeService();
    const result = await service.create(CREATE_DTO, 'actor-1');

    expect(encryption.encrypt).toHaveBeenCalledWith(
      'pii',
      '9999999999',
      expect.objectContaining({ entityType: 'Employee' }),
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Jane Doe',
        nationalIdEnc: 'enc:9999999999',
      }),
    );
    expect(result.nationalId).toBe('masked:9999999999');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'Employee' }),
    );
  });

  it('links an optional userId when the user exists and is not already linked', async () => {
    const { service, repo } = makeService({
      repo: {
        findUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', employeeId: null }),
      },
    });
    await service.create({ ...CREATE_DTO, userId: 'user-1' }, 'actor-1');
    expect(repo.linkUser).toHaveBeenCalledWith('emp-1', 'user-1');
  });

  it('404s when the given userId does not exist', async () => {
    const { service } = makeService({
      repo: { findUserById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create({ ...CREATE_DTO, userId: 'nope' }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('409s when the given userId is already linked to a different employee', async () => {
    const { service } = makeService({
      repo: {
        findUserById: vi
          .fn()
          .mockResolvedValue({ id: 'user-1', employeeId: 'other-emp' }),
      },
    });
    await expect(
      service.create({ ...CREATE_DTO, userId: 'user-1' }, 'actor-1'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('EmployeeService.get', () => {
  it('returns the masked employee with trainings and checklist', async () => {
    const { service } = makeService();
    const detail = await service.get('emp-1', 'actor-1');
    expect(detail.nationalId).toBe('masked:9999999999');
    expect(detail.trainings).toEqual([]);
    expect(detail.deprovisioningChecklist).toBeNull();
  });

  it('404s for an unknown employee', async () => {
    const { service } = makeService({
      repo: { findByIdWithRelations: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope', 'actor-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('EmployeeService.recordTraining / completeTraining', () => {
  const DTO: CreateTrainingDto = {
    trainingName: 'Phishing awareness',
  };

  it('creates a training record', async () => {
    const { service, repo } = makeService();
    await service.recordTraining('emp-1', DTO, 'actor-1');
    expect(repo.createTraining).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 'emp-1',
        trainingName: 'Phishing awareness',
      }),
    );
  });

  it('404s recording a training for an unknown employee', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.recordTraining('nope', DTO, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('completes a training', async () => {
    const { service, repo } = makeService();
    await service.completeTraining('emp-1', 'trn-1', 'actor-1');
    expect(repo.completeTraining).toHaveBeenCalledWith(
      'trn-1',
      'emp-1',
      expect.any(Date),
    );
  });

  it('409s completing an already-completed training', async () => {
    const { service } = makeService({
      repo: {
        completeTraining: vi.fn().mockResolvedValue(null),
        findTrainingById: vi
          .fn()
          .mockResolvedValue({ id: 'trn-1', employeeId: 'emp-1' }),
      },
    });
    await expect(
      service.completeTraining('emp-1', 'trn-1', 'actor-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('404s completing a training that does not belong to this employee', async () => {
    const { service } = makeService({
      repo: {
        completeTraining: vi.fn().mockResolvedValue(null),
        findTrainingById: vi
          .fn()
          .mockResolvedValue({ id: 'trn-1', employeeId: 'other-emp' }),
      },
    });
    await expect(
      service.completeTraining('emp-1', 'trn-1', 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('EmployeeService.terminate', () => {
  it('stamps termination, creates the checklist, and starts the termination_access_revocation SLA timer', async () => {
    const { service, slaTimers, audit } = makeService();
    const checklist = await service.terminate('emp-1', 'actor-1');
    expect(checklist.id).toBe('chk-1');
    expect(slaTimers.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'AccessDeprovisioningChecklist',
        workflowName: 'termination_access_revocation',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'Employee' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'AccessDeprovisioningChecklist',
      }),
    );
  });

  it('404s for an unknown employee', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.terminate('nope', 'actor-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s an already-terminated employee (pre-check)', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(baseEmployee({ terminationDate: new Date() })),
      },
    });
    await expect(service.terminate('emp-1', 'actor-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('409s when a concurrent termination wins the race', async () => {
    const { service } = makeService({
      repo: { terminate: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.terminate('emp-1', 'actor-1')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('EmployeeService.updateChecklist', () => {
  it('ticks a requested sub-item', async () => {
    const { service, repo } = makeService();
    await service.updateChecklist(
      'emp-1',
      { systemAccessRevoked: true },
      'actor-1',
    );
    expect(repo.updateChecklist).toHaveBeenCalledTimes(1);
    const [id, update] = repo.updateChecklist.mock.calls[0] as [
      string,
      { systemAccessRevokedAt: Date },
    ];
    expect(id).toBe('chk-1');
    expect(update.systemAccessRevokedAt).toBeInstanceOf(Date);
  });

  it('deactivates the linked user and kills their sessions when systemAccessRevoked is ticked', async () => {
    const { service, repo, sessions } = makeService({
      repo: {
        findUserByEmployeeId: vi.fn().mockResolvedValue({ id: 'user-1' }),
      },
    });
    await service.updateChecklist(
      'emp-1',
      { systemAccessRevoked: true },
      'actor-1',
    );
    expect(repo.deactivateUser).toHaveBeenCalledWith('user-1');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
      'admin_revoked',
    );
  });

  it('does not touch a linked user when a different sub-item is ticked', async () => {
    const { service, repo, sessions } = makeService({
      repo: {
        findUserByEmployeeId: vi.fn().mockResolvedValue({ id: 'user-1' }),
      },
    });
    await service.updateChecklist(
      'emp-1',
      { physicalAccessRevoked: true },
      'actor-1',
    );
    expect(repo.deactivateUser).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing new is requested (already-set fields)', async () => {
    const { service, repo } = makeService({
      repo: {
        findChecklistByEmployeeId: vi
          .fn()
          .mockResolvedValue(
            baseChecklist({ systemAccessRevokedAt: new Date() }),
          ),
      },
    });
    await service.updateChecklist(
      'emp-1',
      { systemAccessRevoked: true },
      'actor-1',
    );
    expect(repo.updateChecklist).not.toHaveBeenCalled();
  });

  it('404s when no checklist exists for this employee', async () => {
    const { service } = makeService({
      repo: { findChecklistByEmployeeId: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.updateChecklist(
        'emp-1',
        { systemAccessRevoked: true },
        'actor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('409s updating an already-complete checklist', async () => {
    const { service } = makeService({
      repo: {
        findChecklistByEmployeeId: vi
          .fn()
          .mockResolvedValue(baseChecklist({ completedAt: new Date() })),
      },
    });
    await expect(
      service.updateChecklist(
        'emp-1',
        { systemAccessRevoked: true },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('EmployeeService.completeChecklist', () => {
  const fullyDone = baseChecklist({
    systemAccessRevokedAt: new Date(),
    physicalAccessRevokedAt: new Date(),
    deviceReturnedAt: new Date(),
    knowledgeTransferDoneAt: new Date(),
  });

  it('completes the checklist and resolves the SLA timer once every sub-item is done', async () => {
    const { service, slaTimers } = makeService({
      repo: { findChecklistByEmployeeId: vi.fn().mockResolvedValue(fullyDone) },
    });
    await service.completeChecklist('emp-1', 'actor-1');
    expect(slaTimers.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'AccessDeprovisioningChecklist',
        workflowName: 'termination_access_revocation',
      }),
    );
  });

  it('400s when a sub-item is still open', async () => {
    const { service } = makeService();
    await expect(service.completeChecklist('emp-1', 'actor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('404s when no checklist exists', async () => {
    const { service } = makeService({
      repo: { findChecklistByEmployeeId: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.completeChecklist('emp-1', 'actor-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s when a concurrent completion wins the race', async () => {
    const { service } = makeService({
      repo: {
        findChecklistByEmployeeId: vi.fn().mockResolvedValue(fullyDone),
        completeChecklist: vi.fn().mockResolvedValue(null),
      },
    });
    await expect(service.completeChecklist('emp-1', 'actor-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
