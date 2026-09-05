import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import type { InteractionRepository } from '../../repositories/interaction.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { LogInteractionDto } from './dto/log-interaction.dto';

function sales(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'sales-1',
    email: 'sales@ibms.test',
    roles: ['SALES_RELATIONSHIP_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

const OWNED_CUSTOMER = {
  id: 'cust-1',
  legalName: 'Acme Trading LLC',
  customerType: 'CORPORATE',
  status: 'ACTIVE',
  ownerUserId: 'sales-1',
};

function dto(over?: Partial<LogInteractionDto>): LogInteractionDto {
  return { channel: 'CALL', summary: 'Discussed renewal', ...over };
}

function makeDeps() {
  // Mirrors Prisma's default-fill: an undefined `occurredAt` in `data`
  // becomes the DB `@default(now())` value on the returned row.
  const createInteraction = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'int-1',
        createdAt: new Date('2026-03-01T00:00:00Z'),
        ...input,
        occurredAt: input.occurredAt ?? new Date('2026-03-01T00:00:00Z'),
      }),
    );
  const findManyByCustomerId = vi.fn().mockResolvedValue([]);
  const findPoliciesForTimeline = vi.fn().mockResolvedValue([]);
  const findClaimsForTimeline = vi.fn().mockResolvedValue([]);
  const findComplaintsForTimeline = vi.fn().mockResolvedValue([]);
  const interactions = {
    create: createInteraction,
    findManyByCustomerId,
    findPoliciesForTimeline,
    findClaimsForTimeline,
    findComplaintsForTimeline,
  } as unknown as InteractionRepository;

  const findCustomerById = vi.fn().mockResolvedValue(OWNED_CUSTOMER);
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new CrmService(interactions, customers, audit),
    mocks: {
      createInteraction,
      findManyByCustomerId,
      findPoliciesForTimeline,
      findClaimsForTimeline,
      findComplaintsForTimeline,
      findCustomerById,
      record,
    },
  };
}

describe('CrmService.logInteraction', () => {
  it('creates the interaction and writes a CREATE audit row', async () => {
    const { service, mocks } = makeDeps();

    const result = await service.logInteraction('cust-1', dto(), sales());

    expect(result.id).toBe('int-1');
    expect(mocks.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        channel: 'CALL',
        summary: 'Discussed renewal',
        loggedByUserId: 'sales-1',
        occurredAt: undefined,
      }),
    );
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'Interaction',
        entityId: 'int-1',
      }),
    );
  });

  it('is NOT owner-gated — a Claims Officer can log against a customer they do not own', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      ...OWNED_CUSTOMER,
      ownerUserId: 'someone-else',
    });

    await expect(
      service.logInteraction(
        'cust-1',
        dto({ channel: 'CLAIM' }),
        sales({ id: 'claims-1', roles: ['CLAIMS_OFFICER'] }),
      ),
    ).resolves.toMatchObject({ id: 'int-1' });
    expect(mocks.createInteraction).toHaveBeenCalledOnce();
  });

  it('404s when the customer does not exist', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue(null);

    await expect(
      service.logInteraction('gone', dto(), sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.createInteraction).not.toHaveBeenCalled();
  });

  it('422s a future occurredAt', async () => {
    const { service, mocks } = makeDeps();
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    await expect(
      service.logInteraction('cust-1', dto({ occurredAt: future }), sales()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(mocks.createInteraction).not.toHaveBeenCalled();
  });

  it('accepts a backdated occurredAt and passes it through as a Date', async () => {
    const { service, mocks } = makeDeps();
    const past = '2026-01-15T09:30:00.000Z';

    await service.logInteraction('cust-1', dto({ occurredAt: past }), sales());

    expect(mocks.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: new Date(past) }),
    );
  });

  it('422s a datetime occurredAt with no timezone offset (would be parsed as server-local)', async () => {
    const { service, mocks } = makeDeps();

    await expect(
      service.logInteraction(
        'cust-1',
        dto({ occurredAt: '2026-01-15T09:30:00' }),
        sales(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(mocks.createInteraction).not.toHaveBeenCalled();
  });

  it('accepts a plain date occurredAt (no time component, unambiguous)', async () => {
    const { service, mocks } = makeDeps();

    await service.logInteraction(
      'cust-1',
      dto({ occurredAt: '2026-01-15' }),
      sales(),
    );

    expect(mocks.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: new Date('2026-01-15') }),
    );
  });

  it('still returns the interaction when the audit write fails', async () => {
    const { service, mocks } = makeDeps();
    mocks.record.mockRejectedValueOnce(new Error('audit down'));

    await expect(
      service.logInteraction('cust-1', dto(), sales()),
    ).resolves.toMatchObject({ id: 'int-1' });
  });
});

describe('CrmService.listInteractions', () => {
  it("404s another Sales Officer's customer (no existence oracle)", async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      ...OWNED_CUSTOMER,
      ownerUserId: 'someone-else',
    });

    await expect(
      service.listInteractions('cust-1', sales()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a Manager list a customer they do not own', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      ...OWNED_CUSTOMER,
      ownerUserId: 'someone-else',
    });
    mocks.findManyByCustomerId.mockResolvedValue([{ id: 'int-9' }]);

    const rows = await service.listInteractions(
      'cust-1',
      sales({ id: 'mgr-1', roles: ['BRANCH_DEPARTMENT_MANAGER'] }),
    );
    expect(rows).toEqual([{ id: 'int-9' }]);
  });
});

describe('CrmService.get360View', () => {
  it('assembles the aggregate, counts, and a merged timeline', async () => {
    const { service, mocks } = makeDeps();
    mocks.findManyByCustomerId.mockResolvedValue([
      {
        id: 'int-1',
        channel: 'EMAIL',
        summary: 'Sent the quote',
        occurredAt: new Date('2026-02-10T00:00:00Z'),
        loggedByUserId: 'sales-1',
      },
    ]);
    mocks.findPoliciesForTimeline.mockResolvedValue([
      {
        id: 'pol-1',
        policyNumber: 'MP-1',
        insuranceLine: 'Property All Risks',
        status: 'ACTIVE',
        inceptionDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: null,
        createdAt: new Date('2025-12-20T00:00:00Z'),
      },
    ]);

    const view = await service.get360View('cust-1', sales());

    expect(view.customer).toMatchObject({
      id: 'cust-1',
      ownerUserId: 'sales-1',
    });
    expect(view.counts).toEqual({
      interactions: 1,
      policies: 1,
      claims: 0,
      complaints: 0,
    });
    expect(view.timeline.map((e) => e.kind)).toEqual(['INTERACTION', 'POLICY']);
  });

  it('flags the READ audit as sensitive only when a claim is present', async () => {
    const { service, mocks } = makeDeps();

    await service.get360View('cust-1', sales());
    expect(mocks.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'Customer',
        isSensitiveDataAccess: false,
      }),
    );

    mocks.findClaimsForTimeline.mockResolvedValue([
      {
        id: 'clm-1',
        claimNumber: 'C-1',
        status: 'NOTIFIED',
        lossDate: new Date('2026-03-01T00:00:00Z'),
        createdAt: new Date('2026-03-02T00:00:00Z'),
      },
    ]);
    await service.get360View('cust-1', sales());
    // Read the recorded arg directly rather than nesting objectContaining
    // (which trips @typescript-eslint/no-unsafe-assignment).
    const [lastArg] = mocks.record.mock.calls.at(-1) as [
      {
        action: string;
        isSensitiveDataAccess: boolean;
        afterValue: { claims: number };
      },
    ];
    expect(lastArg.action).toBe('READ');
    expect(lastArg.isSensitiveDataAccess).toBe(true);
    expect(lastArg.afterValue.claims).toBe(1);
  });

  it("404s a customer the caller can't see", async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      ...OWNED_CUSTOMER,
      ownerUserId: 'someone-else',
    });

    await expect(service.get360View('cust-1', sales())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets Compliance (a cross-owner role) open any customer 360 view', async () => {
    const { service, mocks } = makeDeps();
    mocks.findCustomerById.mockResolvedValue({
      ...OWNED_CUSTOMER,
      ownerUserId: 'someone-else',
    });

    const view = await service.get360View(
      'cust-1',
      sales({ id: 'comp-1', roles: ['COMPLIANCE_OFFICER'] }),
    );
    expect(view.customer.id).toBe('cust-1');
  });
});
