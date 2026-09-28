import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SlaPolicyService } from './sla-policy.service';
import type { SlaPolicyRepository } from '../../repositories/sla-policy.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateSlaPolicyDto } from './dto/sla-policy.dto';

/**
 * The actor now carries its PERMISSIONS, because `create` reads them.
 *
 * The old fixture was `{ id } as AuthenticatedUser` — a cast past a field the type has, which is a
 * fixture that lies: three tests failed with `Cannot read properties of undefined (reading 'has')`
 * the moment the service asked a real question about the caller. The cast is what let it compile.
 *
 * `regulatoryActor` holds `sla.policy.regulatory`; `actor` deliberately does NOT, so every test
 * that does not mention the regulatory stamp runs as somebody who cannot make that claim.
 */
function actorWith(codes: string[]): AuthenticatedUser {
  // A COMPLETE object, not `{ id } as AuthenticatedUser`. The cast is what let the old fixture omit
  // `permissions` and compile, and the service asking one real question about the caller turned
  // that into `Cannot read properties of undefined (reading 'has')` in three tests. A fixture that
  // satisfies the type cannot hide the next field either.
  return {
    id: 'compliance-1',
    organizationId: 'org-1',
    email: 'compliance@ibms.test',
    roleIds: ['role-1'],
    roles: ['COMPLIANCE_OFFICER'],
    permissions: new Set(codes),
    sessionId: 'session-1',
  };
}

const actor = actorWith(['sla.policy.create', 'sla.policy.update']);
const regulatoryActor = actorWith([
  'sla.policy.create',
  'sla.policy.update',
  'sla.policy.regulatory',
]);

function policyRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    policyCode: 'SLA-TEST',
    policyName: 'Test SLA',
    processType: 'test_process',
    workflowState: null,
    description: null,
    durationValue: 3,
    durationUnit: 'BUSINESS_DAYS',
    calendarType: 'JORDAN_STANDARD',
    customWeekendDays: [],
    workingHoursStart: null,
    workingHoursEnd: null,
    timezone: 'Asia/Amman',
    sourceType: 'INTERNAL_POLICY',
    sourceReference: null,
    sourceDocument: null,
    sourceSection: null,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    escalationEnabled: true,
    warningThreshold: 0.8,
    status: 'DRAFT',
    createdByUserId: 'system',
    updatedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    escalations: [],
    ...over,
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  const policies = {
    findById: vi.fn().mockResolvedValue(policyRow()),
    findByCode: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([policyRow()]),
    create: vi
      .fn()
      .mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve(policyRow(data)),
      ),
    update: vi
      .fn()
      .mockImplementation((_id: string, data: Record<string, unknown>) =>
        Promise.resolve(policyRow(data)),
      ),
    activate: vi.fn().mockResolvedValue(policyRow({ status: 'ACTIVE' })),
    deactivate: vi.fn().mockResolvedValue({ count: 1 }),
    ...(over.policies as object),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new SlaPolicyService(
    policies as unknown as SlaPolicyRepository,
    audit as unknown as AuditService,
  );
  return { service, policies, audit };
}

const baseDto = {
  policyCode: 'SLA-TEST',
  policyName: 'Test SLA',
  processType: 'test_process',
  durationValue: 3,
  durationUnit: 'BUSINESS_DAYS',
  sourceType: 'INTERNAL_POLICY',
} as CreateSlaPolicyDto;

describe('SlaPolicyService — an SLA is only "regulatory" if it names an instrument', () => {
  it('refuses a REGULATORY policy with no citation, and says what to do instead', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.create(
        { ...baseDto, sourceType: 'REGULATORY' },
        // The actor MAY make the claim — so what this test refuses is the missing citation and
        // nothing else. Running it as somebody without the permission would pass for the wrong
        // reason, which is the failure the permission check would otherwise hide.
        regulatoryActor,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.policies.create).not.toHaveBeenCalled();
  });

  it('accepts a REGULATORY policy that cites reference AND document', async () => {
    const deps = makeDeps();
    await deps.service.create(
      {
        ...baseDto,
        sourceType: 'REGULATORY',
        sourceReference: 'PDPL Art. 23(b)',
        sourceDocument: 'PRIV-SOP-05',
      },
      regulatoryActor,
    );
    expect(deps.policies.create).toHaveBeenCalled();
  });

  /*
   * THE STAMP IS GATED IN BOTH DIRECTIONS.
   *
   * Changing a policy to REGULATORY has always needed `sla.policy.regulatory`; CREATING one that
   * way needed only `sla.policy.create`, which two roles hold without it. The stamp claims a
   * deadline is imposed by law, so whoever may make that claim must be the same person either way
   * — and a screen-only guard cannot hold it, because every office defines its own roles.
   */
  it('refuses to CREATE a REGULATORY policy without sla.policy.regulatory, even with citations', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.create(
        {
          ...baseDto,
          sourceType: 'REGULATORY',
          // Fully cited, so the ONLY thing left to refuse is the authority to make the claim. A
          // test without citations could not tell the two refusals apart.
          sourceReference: 'PDPL Art. 23(b)',
          sourceDocument: 'PRIV-SOP-05',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.policies.create).not.toHaveBeenCalled();
  });

  it('lets the same caller create a NON-regulatory policy, so the refusal is about the claim', async () => {
    const deps = makeDeps();
    // The complement, and it is the half that stops the check being "this role cannot create
    // policies": the identical actor succeeds the moment the stamp is not REGULATORY.
    await deps.service.create(
      { ...baseDto, sourceType: 'INTERNAL_POLICY' },
      actor,
    );
    expect(deps.policies.create).toHaveBeenCalled();
  });

  it('names the permission and the honest alternative in the refusal', async () => {
    const deps = makeDeps();
    // A refusal that does not name the code sends the reader to ask for the wrong grant, and one
    // that does not name INTERNAL_POLICY leaves them with no way forward — which is how an
    // internal target ends up recorded as a legal requirement by whoever DOES hold the code.
    await expect(
      deps.service.create(
        {
          ...baseDto,
          sourceType: 'REGULATORY',
          sourceReference: 'PDPL Art. 23(b)',
          sourceDocument: 'PRIV-SOP-05',
        },
        actor,
      ),
    ).rejects.toThrow(/sla\.policy\.regulatory[\s\S]*INTERNAL_POLICY/);
  });

  it('treats a whitespace-only citation as no citation', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.create(
        {
          ...baseDto,
          sourceType: 'REGULATORY',
          sourceReference: '   ',
          sourceDocument: '  ',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('accepts an INTERNAL_POLICY with no citation — the honest home for a drafted figure', async () => {
    const deps = makeDeps();
    await deps.service.create(baseDto, actor);
    expect(deps.policies.create).toHaveBeenCalled();
  });

  it('exposes isRegulatory and a ready-to-render source label', async () => {
    const deps = makeDeps({
      policies: {
        findById: vi.fn().mockResolvedValue(
          policyRow({
            sourceType: 'REGULATORY',
            sourceReference: 'DSR — Access',
            sourceDocument: 'PRIV-STD-01',
            sourceSection: '§6.4',
          }),
        ),
      },
    });
    const view = await deps.service.get('p-1');
    expect(view.isRegulatory).toBe(true);
    expect(view.sourceLabel).toBe('Regulatory — PRIV-STD-01 §6.4');
  });

  it('never labels a non-regulatory policy as regulatory', async () => {
    const deps = makeDeps();
    const view = await deps.service.get('p-1');
    expect(view.isRegulatory).toBe(false);
    expect(view.sourceLabel).toBe('Internal policy');
  });
});

describe('SlaPolicyService — changing the legal claim is separately controlled', () => {
  it('refuses a source-type change without sla.policy.regulatory', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.update(
        'p-1',
        {
          sourceType: 'REGULATORY',
          sourceReference: 'X',
          sourceDocument: 'Y',
        },
        actor,
        false,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.policies.update).not.toHaveBeenCalled();
  });

  it('allows an ordinary DURATION change without that permission', async () => {
    // The point of the split: shortening a deadline is a normal governance
    // edit; declaring it the law is not.
    const deps = makeDeps();
    await deps.service.update('p-1', { durationValue: 5 }, actor, false);
    expect(deps.policies.update).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ durationValue: 5 }),
    );
  });

  it('allows the source change when the permission IS held', async () => {
    const deps = makeDeps();
    await deps.service.update(
      'p-1',
      { sourceType: 'REGULATORY', sourceReference: 'X', sourceDocument: 'Y' },
      actor,
      true,
    );
    expect(deps.policies.update).toHaveBeenCalled();
  });

  it('does not trip the gate when the submitted value is unchanged', async () => {
    const deps = makeDeps();
    await deps.service.update(
      'p-1',
      { sourceType: 'INTERNAL_POLICY', durationValue: 4 },
      actor,
      false,
    );
    expect(deps.policies.update).toHaveBeenCalled();
  });
});

describe('SlaPolicyService — the lifecycle is audited', () => {
  it('records creation with the full policy snapshot', async () => {
    const deps = makeDeps();
    await deps.service.create(baseDto, actor);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'SlaPolicy',
        userId: 'compliance-1',
      }),
    );
  });

  it('records BOTH before and after on an edit — "somebody edited this" is not an audit trail', async () => {
    const deps = makeDeps();
    await deps.service.update('p-1', { durationValue: 9 }, actor, false);
    const call = deps.audit.record.mock.calls.find(
      ([i]: [{ action: string }]) => i.action === 'UPDATE',
    ) as [{ beforeValue: unknown; afterValue: unknown }];
    expect(call[0].beforeValue).toMatchObject({ durationValue: 3 });
    expect(call[0].afterValue).toMatchObject({ durationValue: 9 });
  });

  it('records activation and deactivation distinctly', async () => {
    const activated = makeDeps();
    await activated.service.activate('p-1', actor);
    expect(activated.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPROVE', entityType: 'SlaPolicy' }),
    );

    const deactivated = makeDeps({
      policies: {
        findById: vi.fn().mockResolvedValue(policyRow({ status: 'ACTIVE' })),
      },
    });
    await deactivated.service.deactivate('p-1', actor);
    expect(deactivated.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REJECT', entityType: 'SlaPolicy' }),
    );
  });

  it('a new policy is never born ACTIVE — activation is its own decision', async () => {
    const deps = makeDeps();
    await deps.service.create(baseDto, actor);
    expect(deps.policies.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DRAFT' }),
      expect.anything(),
    );
  });

  it('409s when a policy is activated concurrently', async () => {
    const deps = makeDeps({
      policies: { activate: vi.fn().mockResolvedValue(null) },
    });
    await expect(deps.service.activate('p-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('activating an already-active policy is idempotent, not an error', async () => {
    const deps = makeDeps({
      policies: {
        findById: vi.fn().mockResolvedValue(policyRow({ status: 'ACTIVE' })),
      },
    });
    const view = await deps.service.activate('p-1', actor);
    expect(view.status).toBe('ACTIVE');
    expect(deps.policies.activate).not.toHaveBeenCalled();
  });

  it('never fails the write because the audit row could not be written', async () => {
    const deps = makeDeps();
    deps.audit.record.mockRejectedValue(new Error('audit down'));
    await expect(deps.service.create(baseDto, actor)).resolves.toBeDefined();
  });
});
