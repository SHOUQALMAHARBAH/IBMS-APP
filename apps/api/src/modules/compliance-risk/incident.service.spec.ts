import { describe, expect, it, vi } from 'vitest';
import { segregatedOfficeDutySegregation } from '../duty-segregation/duty-segregation.double';
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
import type { UserRepository } from '../../repositories/user.repository';

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
  // Owner decision 56. This helper is typed `Record<string, unknown>` rather than the
  // model, so the compiler could NOT name it — it failed at runtime instead, with
  // `Cannot read properties of undefined (reading 'map')` out of the view mapper. The
  // sibling fixture in `incident.config.spec.ts` IS typed to the row and was named at
  // compile time, which is the argument for that typing in one line.
  containmentActions: [],
  touchesPersonalData: null,
  dataCategoriesAffected: null,
  subjectsAffectedEstimate: null,
  occurredAt: null,
  reportedByUserId: null,
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
    // Owner decision 56 — PRIV-SRS-02's `containment_actions` log.
    appendContainmentAction: vi.fn().mockResolvedValue({ id: 'ica-1' }),
    ...over.repo,
  };
  /* Decision 48's resolver. The map holds ONE id on purpose: a double that answered for
   * every actor could not tell a resolved name from the `?? uuid` fallback the view
   * forbids, which is the distinction decision 56's log exists to keep. */
  const displayNamesForUserIds = vi.fn((ids: (string | null)[]) =>
    Promise.resolve(
      new Map(
        ids
          .filter((id): id is string => id === 'u-responder')
          .map((id) => [id, 'Ahmad Al-Test'] as const),
      ),
    ),
  );
  const users = { displayNamesForUserIds } as unknown as UserRepository;

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
  // The SHARED double, not a local `mockResolvedValue(null)`: a permissive mock would make this file's
  // own self-approval assertions pass on the mock rather than on the code.
  const dutySegregation = segregatedOfficeDutySegregation();

  const service = new IncidentService(
    repo as unknown as IncidentRepository,
    workflow as unknown as WorkflowTransitionService,
    slaTimer as unknown as SlaTimerService,
    audit as unknown as AuditService,
    dutySegregation,
    users,
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
    await service.contain(
      'incident-1',
      { description: 'Isolated the mail server from the network.' },
      'u-responder',
    );
    expect(slaTimer.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'incident_containment' }),
    );
  });

  /*
   * RE-POINTED BY OWNER DECISION 56, AND THE REVERSAL IS THE POINT.
   *
   * This test was called 'is idempotent if already CONTAINED' and asserted that a second
   * call did NOTHING. That was right while containment was a bare timestamp and wrong the
   * moment it became a LOG: `PRIV-SRS-02` types `containment_actions` as timestamped and
   * PLURAL, and `PRIV-SOP-09` step 3 is «عزل الأنظمة أو الحسابات المتأثرة» — routinely
   * more than one action. So a second containment action is a NEW ENTRY.
   *
   * It is also the third reading of the owner's own sentence, «الزر يقول إنه تم وأنا ما
   * عملت شي»: under the old behaviour a second press returned SUCCESS having written
   * nothing at all.
   *
   * What survives unchanged is the half that was always correct and is still asserted
   * below: the STATUS TRANSITION happens once.
   */
  it('«بس بغيّر الحالة إلى تم احتوائه» — a second containment APPENDS, and only the status happens once', async () => {
    const append = vi.fn().mockResolvedValue({ id: 'ica-2' });
    const { service, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'CONTAINED' })),
        appendContainmentAction: append,
      },
    });
    const v = await service.contain(
      'incident-1',
      { description: 'Also disabled the compromised account.' },
      'u-responder',
    );
    expect(v.status).toBe('CONTAINED');
    // THE APPEND HAPPENED — the half the old test asserted away.
    expect(append).toHaveBeenCalledWith({
      incidentReportId: 'incident-1',
      description: 'Also disabled the compromised account.',
      actionTakenByUserId: 'u-responder',
    });
    // And the transition did not repeat, which is what 'idempotent' correctly meant.
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('«الزر يقول إنه تم وأنا ما عملت شي» — the action is written BEFORE the stamp, so the stamp cannot exist alone', async () => {
    const order: string[] = [];
    const append = vi.fn().mockImplementation(() => {
      order.push('append');
      return Promise.resolve({ id: 'ica-1' });
    });
    const { service, workflow } = makeService({
      repo: { appendContainmentAction: append },
    });
    workflow.transition = vi
      .fn()
      .mockImplementation((params: { entityId: string; toStatus: string }) => {
        order.push('transition');
        return Promise.resolve({
          id: params.entityId,
          status: params.toStatus,
        });
      });
    await service.contain(
      'incident-1',
      { description: 'Isolated the server now.' },
      'u1',
    );
    /* `IncidentReport_contained_needs_an_action` refuses to stamp `containedAt` while the
     * log is empty, so this ordering is load-bearing rather than stylistic: reversed, the
     * transition would fail against a real database and the act would be unusable. */
    expect(order).toEqual(['append', 'transition']);
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
    const v = await service.contain(
      'incident-1',
      { description: 'Isolated the mail server from the network.' },
      'u-responder',
    );
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
    const v = await service.assessImpact(
      'incident-1',
      {
        touchesPersonalData: true,
        dataCategoriesAffected: 'Customer names and contact details.',
        subjectsAffectedEstimate: 42,
      },
      'u-responder',
    );
    expect(workflow.transition.mock.calls[0]?.[0]).toMatchObject({
      toStatus: 'IMPACT_ASSESSED',
    });
    expect(v.status).toBe('IMPACT_ASSESSED');
  });

  /*
   * OWNER DECISION 56 — «بس بظهرلي إنه تم تقييم أثره وأنا ما قيّمت ولا عملت شي».
   *
   * The assessment's THREE outputs reach the write, which is the whole of what she
   * pressed. Asserted on the transition's `data` rather than on the returned view,
   * because the view is derived from a mocked read: a `toMatchObject` on the view would
   * pass against a service that threw the body away.
   */
  it('«بس بظهرلي إنه تم تقييم أثره وأنا ما قيّمت ولا عملت شي» — all three of step 4 outputs reach the write, not just a timestamp', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'CONTAINED' }))
          .mockResolvedValue(row({ status: 'IMPACT_ASSESSED' })),
      },
    });
    await service.assessImpact(
      'incident-1',
      {
        touchesPersonalData: true,
        dataCategoriesAffected: 'Customer names and contact details.',
        subjectsAffectedEstimate: 42,
      },
      'u-dpo',
    );
    const data = (
      workflow.transition.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data).toMatchObject({
      touchesPersonalData: true,
      dataCategoriesAffected: 'Customer names and contact details.',
      subjectsAffectedEstimate: 42,
    });
    // And the timestamp still goes with them — all four in ONE transition, so the
    // row-level CHECK can never see a half-written assessment.
    expect(data.impactAssessedAt).toBeInstanceOf(Date);
  });

  it('«ما قيّمت ولا عملت شي» is NOT what `false` and 0 mean — they are real assessment results', async () => {
    const { service, workflow } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(row({ status: 'CONTAINED' }))
          .mockResolvedValue(row({ status: 'IMPACT_ASSESSED' })),
      },
    });
    await service.assessImpact(
      'incident-1',
      {
        touchesPersonalData: false,
        dataCategoriesAffected: 'No personal data — internal build logs only.',
        subjectsAffectedEstimate: 0,
      },
      'u-dpo',
    );
    /* An incident that touched nobody is an ASSESSMENT RESULT, and a service that treated
     * `false`/0 as absent would make 'assessed, and it is not a privacy matter'
     * indistinguishable from 'never assessed' — which is the distinction this whole
     * decision exists to restore. */
    const data = (
      workflow.transition.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.touchesPersonalData).toBe(false);
    expect(data.subjectsAffectedEstimate).toBe(0);
  });
});

describe('IncidentService.classify (Process 55)', () => {
  it('no longer refuses by ROLE NAME — the permission gate owns that decision', async () => {
    // Until Phase 2 this method threw for a caller whose roles did not include
    // DATA_PROTECTION_OFFICER, because `incident.classify` gated BOTH the
    // classify and the co-sign route and the name was the only thing telling
    // them apart. A role an office defined satisfied neither check.
    //
    // The code is now split, so `incident.classify` is granted to the DPO alone
    // and `@RequirePermissions` refuses everyone else before the request ever
    // reaches here. A second check in the service would be a name gate by
    // another route — which is exactly what this phase removes — so the service
    // must NOT re-check. `incident.e2e-spec.ts` proves the route itself refuses.
    const { service, workflow } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(row({ status: 'IMPACT_ASSESSED' })),
      },
    });
    await service.classify(
      'incident-1',
      { classification: 'NON_MATERIAL' },
      exec,
    );
    // Asserted on the transition rather than the returned view: the view is
    // re-read through the same `findById` mock, which still answers with the
    // pre-transition row. Reaching the transition at all is the point.
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'IncidentReport',
        toStatus: 'CLASSIFIED',
        actorUserId: 'u-exec',
      }),
    );
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

  it('is idempotent if already co-signed (checked before the segregation check)', async () => {
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

  it('no longer refuses by ROLE NAME — the permission gate owns that decision', async () => {
    // Same reasoning as classify: the co-sign route now carries its own
    // `incident.classification.co-sign`, so refusing a caller who does not hold
    // it is the guard's job, not this method's. A second name check here would
    // be the very thing this phase removes.
    //
    // The classifier here is a THIRD person, so the segregation check below has
    // nothing to object to — that check is asserted separately, and it is the
    // one that cannot be configured away.
    const { service, repo } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(
          row({
            status: 'CLASSIFIED',
            classification: 'MATERIAL',
            classifiedByDpoUserId: 'u-someone-else',
          }),
        ),
      },
    });
    await service.coSign('incident-1', dpo);
    expect(repo.recordCoSign).toHaveBeenCalledWith('incident-1', 'u-dpo', null);
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
    expect(repo.recordCoSign).toHaveBeenCalledWith(
      'incident-1',
      'u-exec',
      null,
    );
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
