import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IncidentService } from './incident.service';
import type { IncidentRepository } from '../../repositories/incident.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'incident-1',
  title: 'Phishing email',
  description: 'Three staff clicked a malicious link.',
  severity: 'critical',
  status: 'REPORTED',
  reportedAt: new Date('2026-09-06T09:00:00.000Z'),
  containedAt: null,
  impactAssessedAt: null,
  classification: 'NOT_YET_CLASSIFIED',
  classifiedByDpoUserId: null,
  seniorManagementCoSignUserId: null,
  seniorManagementNotifiedAt: null,
  notifiedRegulators: [],
  notifiedAt: null,
  affectedDataSubjectsNotifiedAt: null,
  rootCauseAnalysis: null,
  recoveredAt: null,
  closedAt: null,
  ...over,
});

const dpo: AuthenticatedUser = {
  id: 'u-dpo',
  roles: ['DATA_PROTECTION_OFFICER'],
} as AuthenticatedUser;
const exec: AuthenticatedUser = {
  id: 'u-exec',
  roles: ['EXECUTIVE_MANAGEMENT'],
} as AuthenticatedUser;
const other: AuthenticatedUser = {
  id: 'u-other',
  roles: ['COMPLIANCE_OFFICER'],
} as AuthenticatedUser;
const dualRole: AuthenticatedUser = {
  id: 'u-dual',
  roles: ['DATA_PROTECTION_OFFICER', 'EXECUTIVE_MANAGEMENT'],
} as AuthenticatedUser;

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(row()),
    findById: vi.fn().mockResolvedValue(row()),
    findMany: vi.fn().mockResolvedValue([row()]),
    recordCoSign: vi.fn().mockResolvedValue({ count: 1 }),
    recordSeniorManagementNotified: vi.fn().mockResolvedValue({ count: 1 }),
    recordAffectedSubjectsNotified: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.repo,
  };
  const workflow = {
    transition: vi
      .fn()
      .mockImplementation(
        async (params: {
          entityId: string;
          toStatus: string;
          sideEffect?: (r: { id: string; status: string }) => Promise<void>;
        }) => {
          if (params.sideEffect) {
            await params.sideEffect({
              id: params.entityId,
              status: params.toStatus,
            });
          }
          return { id: params.entityId, status: params.toStatus };
        },
      ),
  };
  const slaTimer = {
    computeDueAt: vi.fn().mockReturnValue(new Date('2026-09-06T13:00:00.000Z')),
    startTimer: vi.fn().mockResolvedValue([{ id: 'sla-1' }]),
    resolve: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new IncidentService(
    repo as unknown as IncidentRepository,
    workflow as unknown as WorkflowTransitionService,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, repo, workflow, slaTimer, audit };
}

describe('IncidentService.create (Process 55)', () => {
  it('starts the containment SLA timer for critical severity', async () => {
    const { service, slaTimer } = makeService();
    await service.create(
      { title: 'x', description: 'y', severity: 'critical' },
      'u-reporter',
    );
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'incident_containment' }),
    );
  });

  it('does not start a containment timer for non-critical severity', async () => {
    const { service, slaTimer } = makeService({
      repo: { create: vi.fn().mockResolvedValue(row({ severity: 'medium' })) },
    });
    await service.create(
      { title: 'x', description: 'y', severity: 'medium' },
      'u-reporter',
    );
    expect(slaTimer.startTimer).not.toHaveBeenCalled();
  });

  it('audits CREATE as sensitive', async () => {
    const { service, audit } = makeService();
    await service.create(
      { title: 'x', description: 'y', severity: 'low' },
      'u-reporter',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        isSensitiveDataAccess: true,
      }),
    );
  });
});

describe('IncidentService.contain (Process 55)', () => {
  it('resolves the containment SLA timer as a side effect', async () => {
    const { service, slaTimer } = makeService();
    await service.contain('incident-1', 'u-responder');
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'incident_containment' }),
    );
  });

  it('is idempotent if already CONTAINED', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'CONTAINED' })),
      },
    });
    const v = await service.contain('incident-1', 'u-responder');
    expect(v.status).toBe('CONTAINED');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('a genuinely concurrent double-call is race-safe', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'REPORTED' }))
          .mockResolvedValue(row({ status: 'CONTAINED' })),
      },
    });
    workflow.transition = vi.fn().mockRejectedValue(new ConflictException('x'));
    const v = await service.contain('incident-1', 'u-responder');
    expect(v.status).toBe('CONTAINED');
  });
});

describe('IncidentService.assessImpact (Process 55)', () => {
  it('transitions CONTAINED -> IMPACT_ASSESSED, stamping impactAssessedAt', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'CONTAINED' }))
          .mockResolvedValue(row({ status: 'IMPACT_ASSESSED' })),
      },
    });
    const v = await service.assessImpact('incident-1', 'u-responder');
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'IMPACT_ASSESSED',
    });
    expect(v.status).toBe('IMPACT_ASSESSED');
  });
});

describe('IncidentService.classify (Process 55) — DPO only', () => {
  it('403s a caller without the DATA_PROTECTION_OFFICER role', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'IMPACT_ASSESSED' })),
      },
    });
    await expect(
      service.classify('incident-1', { classification: 'MATERIAL' }, exec),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stamps classification + classifiedByDpoUserId and starts the SLA timer for MATERIAL', async () => {
    const { service, workflow, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IMPACT_ASSESSED' }))
          .mockResolvedValue(
            row({
              status: 'CLASSIFIED',
              classification: 'MATERIAL',
              classifiedByDpoUserId: 'u-dpo',
            }),
          ),
      },
    });
    const v = await service.classify(
      'incident-1',
      { classification: 'MATERIAL' },
      dpo,
    );
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'CLASSIFIED',
      data: { classification: 'MATERIAL', classifiedByDpoUserId: 'u-dpo' },
    });
    expect(slaTimer.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'incident_senior_management_notification',
      }),
    );
    expect(v.status).toBe('CLASSIFIED');
  });

  it('does NOT start the senior-management SLA timer for NON_MATERIAL', async () => {
    const { service, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IMPACT_ASSESSED' }))
          .mockResolvedValue(
            row({ status: 'CLASSIFIED', classification: 'NON_MATERIAL' }),
          ),
      },
    });
    await service.classify(
      'incident-1',
      { classification: 'NON_MATERIAL' },
      dpo,
    );
    expect(slaTimer.startTimer).not.toHaveBeenCalled();
  });

  it('is idempotent on a re-call with the SAME classification', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'CLASSIFIED', classification: 'MATERIAL' }),
          ),
      },
    });
    const v = await service.classify(
      'incident-1',
      { classification: 'MATERIAL' },
      dpo,
    );
    expect(v.classification).toBe('MATERIAL');
  });

  it('409s a re-call with a DIFFERENT classification', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'CLASSIFIED', classification: 'MATERIAL' }),
          ),
      },
    });
    await expect(
      service.classify('incident-1', { classification: 'NON_MATERIAL' }, dpo),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('IncidentService.coSign (Process 55) — Executive Management only, Material only', () => {
  it('422s a NON_MATERIAL incident', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'CLASSIFIED', classification: 'NON_MATERIAL' }),
          ),
      },
    });
    await expect(service.coSign('incident-1', exec)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('is idempotent if already co-signed (checked before the role check)', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            status: 'CLASSIFIED',
            classification: 'MATERIAL',
            seniorManagementCoSignUserId: 'u-exec-1',
          }),
        ),
      },
    });
    const v = await service.coSign('incident-1', other);
    expect(v.seniorManagementCoSignUserId).toBe('u-exec-1');
  });

  it('403s a caller without the EXECUTIVE_MANAGEMENT role', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'CLASSIFIED', classification: 'MATERIAL' }),
          ),
      },
    });
    await expect(service.coSign('incident-1', dpo)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('422s (fail closed) if classified but no recorded classifier', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            status: 'CLASSIFIED',
            classification: 'MATERIAL',
            classifiedByDpoUserId: null,
          }),
        ),
      },
    });
    await expect(service.coSign('incident-1', exec)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('403s when the co-signer is the same person who classified it', async () => {
    const { service } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            status: 'CLASSIFIED',
            classification: 'MATERIAL',
            classifiedByDpoUserId: 'u-exec',
          }),
        ),
      },
    });
    await expect(service.coSign('incident-1', exec)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('records the co-sign by a different Executive Management officer', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({
              status: 'CLASSIFIED',
              classification: 'MATERIAL',
              classifiedByDpoUserId: 'u-dpo',
            }),
          )
          .mockResolvedValue(
            row({
              status: 'CLASSIFIED',
              classification: 'MATERIAL',
              classifiedByDpoUserId: 'u-dpo',
              seniorManagementCoSignUserId: 'u-exec',
            }),
          ),
      },
    });
    const v = await service.coSign('incident-1', exec);
    expect(repo.recordCoSign).toHaveBeenCalledWith('incident-1', 'u-exec');
    expect(v.seniorManagementCoSignUserId).toBe('u-exec');
  });

  it('a single user holding BOTH DPO and Executive Management roles cannot self-classify-and-co-sign', async () => {
    // classify() passes the role check (dualRole holds DATA_PROTECTION_OFFICER)
    // and stamps classifiedByDpoUserId = dualRole.id.
    const classifyRun = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'IMPACT_ASSESSED' }))
          .mockResolvedValue(
            row({
              status: 'CLASSIFIED',
              classification: 'MATERIAL',
              classifiedByDpoUserId: 'u-dual',
            }),
          ),
      },
    });
    await classifyRun.service.classify(
      'incident-1',
      { classification: 'MATERIAL' },
      dualRole,
    );

    // coSign() passes the role check too (dualRole ALSO holds
    // EXECUTIVE_MANAGEMENT) — but assertDifferentActors rejects it because
    // classifiedByDpoUserId equals the same actor id.
    const coSignRun = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            status: 'CLASSIFIED',
            classification: 'MATERIAL',
            classifiedByDpoUserId: 'u-dual',
          }),
        ),
      },
    });
    await expect(
      coSignRun.service.coSign('incident-1', dualRole),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('IncidentService.notifySeniorManagement (Process 55)', () => {
  it('422s a NON_MATERIAL incident', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ classification: 'NON_MATERIAL' })),
      },
    });
    await expect(
      service.notifySeniorManagement('incident-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('stamps seniorManagementNotifiedAt and resolves the SLA timer', async () => {
    const { service, repo, slaTimer } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ classification: 'MATERIAL' }))
          .mockResolvedValue(
            row({
              classification: 'MATERIAL',
              seniorManagementNotifiedAt: new Date(),
            }),
          ),
      },
    });
    const v = await service.notifySeniorManagement('incident-1', 'u-dpo');
    expect(repo.recordSeniorManagementNotified).toHaveBeenCalled();
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'incident_senior_management_notification',
      }),
    );
    expect(v.seniorManagementNotifiedAt).not.toBeNull();
  });

  it('is idempotent if already notified', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            classification: 'MATERIAL',
            seniorManagementNotifiedAt: new Date(),
          }),
        ),
      },
    });
    await service.notifySeniorManagement('incident-1', 'u-dpo');
    expect(repo.recordSeniorManagementNotified).not.toHaveBeenCalled();
  });
});

describe('IncidentService.notifyRegulators (Process 55)', () => {
  it('422s a MATERIAL incident with no co-sign yet', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'CLASSIFIED', classification: 'MATERIAL' }),
          ),
      },
    });
    await expect(
      service.notifyRegulators('incident-1', { regulators: ['CBJ'] }, 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('succeeds for a MATERIAL incident once co-signed', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({
              status: 'CLASSIFIED',
              classification: 'MATERIAL',
              seniorManagementCoSignUserId: 'u-exec',
            }),
          )
          .mockResolvedValue(
            row({
              status: 'NOTIFIED',
              classification: 'MATERIAL',
              seniorManagementCoSignUserId: 'u-exec',
              notifiedRegulators: ['CBJ'],
            }),
          ),
      },
    });
    const v = await service.notifyRegulators(
      'incident-1',
      { regulators: ['CBJ'] },
      'u-dpo',
    );
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'NOTIFIED',
    });
    expect(v.notifiedRegulators).toEqual(['CBJ']);
  });

  it('succeeds for a NON_MATERIAL incident with no co-sign required', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({ status: 'CLASSIFIED', classification: 'NON_MATERIAL' }),
          )
          .mockResolvedValue(
            row({
              status: 'NOTIFIED',
              classification: 'NON_MATERIAL',
              notifiedRegulators: ['NCSC'],
            }),
          ),
      },
    });
    const v = await service.notifyRegulators(
      'incident-1',
      { regulators: ['NCSC'] },
      'u-dpo',
    );
    expect(v.status).toBe('NOTIFIED');
  });

  it('is idempotent on the SAME regulator set (order-independent)', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'NOTIFIED', notifiedRegulators: ['CBJ', 'NCSC'] }),
          ),
      },
    });
    const v = await service.notifyRegulators(
      'incident-1',
      { regulators: ['NCSC', 'CBJ'] },
      'u-dpo',
    );
    expect(v.status).toBe('NOTIFIED');
  });

  it('409s on a DIFFERENT regulator set', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'NOTIFIED', notifiedRegulators: ['CBJ'] }),
          ),
      },
    });
    await expect(
      service.notifyRegulators('incident-1', { regulators: ['NCSC'] }, 'u-dpo'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('IncidentService.notifyAffectedSubjects (Process 55)', () => {
  it('422s when not yet classified', async () => {
    const { service } = makeService();
    await expect(
      service.notifyAffectedSubjects('incident-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s a MATERIAL incident with no co-sign yet (review-fix regression — gate parity with notifyRegulators)', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ classification: 'MATERIAL' })),
      },
    });
    await expect(
      service.notifyAffectedSubjects('incident-1', 'u-dpo'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('succeeds for a MATERIAL incident once co-signed', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(
            row({
              classification: 'MATERIAL',
              seniorManagementCoSignUserId: 'u-exec',
            }),
          )
          .mockResolvedValue(
            row({
              classification: 'MATERIAL',
              seniorManagementCoSignUserId: 'u-exec',
              affectedDataSubjectsNotifiedAt: new Date(),
            }),
          ),
      },
    });
    const v = await service.notifyAffectedSubjects('incident-1', 'u-dpo');
    expect(repo.recordAffectedSubjectsNotified).toHaveBeenCalled();
    expect(v.affectedDataSubjectsNotifiedAt).not.toBeNull();
  });

  it('stamps affectedDataSubjectsNotifiedAt once classified', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ classification: 'NON_MATERIAL' }))
          .mockResolvedValue(
            row({
              classification: 'NON_MATERIAL',
              affectedDataSubjectsNotifiedAt: new Date(),
            }),
          ),
      },
    });
    const v = await service.notifyAffectedSubjects('incident-1', 'u-dpo');
    expect(repo.recordAffectedSubjectsNotified).toHaveBeenCalled();
    expect(v.affectedDataSubjectsNotifiedAt).not.toBeNull();
  });
});

describe('IncidentService.recover / close (Process 55)', () => {
  it('recover stamps recoveredAt', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'NOTIFIED' }))
          .mockResolvedValue(row({ status: 'RECOVERED' })),
      },
    });
    const v = await service.recover('incident-1', 'u-responder');
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'RECOVERED',
    });
    expect(v.status).toBe('RECOVERED');
  });

  it('close requires rootCauseAnalysis and stamps closedAt', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'RECOVERED' }))
          .mockResolvedValue(
            row({
              status: 'CLOSED',
              rootCauseAnalysis: 'Phishing filter misconfigured.',
            }),
          ),
      },
    });
    const v = await service.close(
      'incident-1',
      { rootCauseAnalysis: 'Phishing filter misconfigured.' },
      'u-responder',
    );
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'CLOSED',
      data: { rootCauseAnalysis: 'Phishing filter misconfigured.' },
    });
    expect(v.status).toBe('CLOSED');
  });

  it('close is idempotent on the SAME root cause text', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'CLOSED', rootCauseAnalysis: 'x' })),
      },
    });
    const v = await service.close(
      'incident-1',
      { rootCauseAnalysis: 'x' },
      'u-responder',
    );
    expect(v.status).toBe('CLOSED');
  });

  it('close 409s on a DIFFERENT root cause text', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValue(row({ status: 'CLOSED', rootCauseAnalysis: 'x' })),
      },
    });
    await expect(
      service.close('incident-1', { rootCauseAnalysis: 'y' }, 'u-responder'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('IncidentService reads (Process 55) — audited (sensitive)', () => {
  it('get() writes a READ audit row', async () => {
    const { service, audit } = makeService();
    await service.get('incident-1', 'u-dpo');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'READ', isSensitiveDataAccess: true }),
    );
  });

  it('list() writes a READ audit row and passes filters through', async () => {
    const { service, repo, audit } = makeService();
    await service.list({ status: 'REPORTED' }, 'u-dpo');
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REPORTED' }),
      expect.any(Number),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'READ', entityId: 'list' }),
    );
  });
});
