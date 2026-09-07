import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import type { InvoiceRepository } from '../../repositories/invoice.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const d = (s: string) => new Prisma.Decimal(s);

const actor: AuthenticatedUser = {
  id: 'fin-1',
  email: 'finance@ibms.test',
  roles: ['FINANCE_COLLECTIONS_OFFICER'],
  sessionId: 's-1',
};

const POLICY = {
  id: 'pol-1',
  customerId: 'cust-1',
  opportunityId: 'opp-1',
  issuedPremium: d('1000.000'),
  currency: 'JOD',
};

function isoDaysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function makeDeps(over?: {
  policy?: unknown;
  rate?: Prisma.Decimal | null;
  existing?: unknown;
}) {
  const invoices = {
    findNewBusinessPremiumInvoice: vi
      .fn()
      .mockResolvedValue(over?.existing ?? null),
    create: vi.fn((row: Record<string, unknown>) =>
      Promise.resolve({
        id: 'inv-1',
        status: 'INVOICED',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        ...row,
      }),
    ),
    findById: vi.fn(),
    findManyByPolicyId: vi.fn().mockResolvedValue([]),
    findManyByCustomerId: vi.fn().mockResolvedValue([]),
  };
  const policies = {
    findById: vi
      .fn()
      .mockResolvedValue(over?.policy === undefined ? POLICY : over.policy),
  };
  const recommendations = {
    findByOpportunityId: vi
      .fn()
      .mockResolvedValue(
        over?.rate === undefined
          ? { recommendedQuotation: { commissionRatePercent: d('12.5') } }
          : { recommendedQuotation: { commissionRatePercent: over.rate } },
      ),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new InvoiceService(
    invoices as unknown as InvoiceRepository,
    policies as unknown as PolicyRepository,
    recommendations as unknown as RecommendationRepository,
    audit as unknown as AuditService,
  );
  return { service, invoices, policies, recommendations, audit };
}

const dto = () => ({
  policyId: 'pol-1',
  taxAmount: '160.000',
  feesAmount: '25.000',
  dueDate: isoDaysAhead(30),
});

describe('InvoiceService.create (Process 31)', () => {
  it('raises the invoice with server-composed figures and audits the CREATE', async () => {
    const { service, invoices, audit } = makeDeps();
    const view = await service.create(dto(), actor);

    expect(invoices.create).toHaveBeenCalledTimes(1);
    const row = invoices.create.mock.calls[0]?.[0];
    expect(row.customerId).toBe('cust-1'); // from the policy, never the DTO
    expect(row.invoiceType).toBe('new_business_premium');
    expect((row.premiumAmount as Prisma.Decimal).toFixed(3)).toBe('1000.000');
    expect((row.commissionDeducted as Prisma.Decimal).toFixed(3)).toBe(
      '125.000',
    ); // 1000 * 12.5%
    expect((row.totalAmount as Prisma.Decimal).toFixed(3)).toBe('1060.000'); // 1000 + 160 + 25 - 125
    expect(view.totalAmount).toBe('1060.000');
    expect(view.status).toBe('INVOICED');

    const auditArg = audit.record.mock.calls[0]?.[0] as {
      action: string;
      entityType: string;
      afterValue: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('CREATE');
    expect(auditArg.entityType).toBe('Invoice');
    expect(auditArg.afterValue).toMatchObject({
      totalAmount: '1060.000',
      commissionRatePercent: '12.50',
    });
  });

  it('404s when the policy does not exist', async () => {
    const { service } = makeDeps({ policy: null });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('422s when the policy has no issued premium', async () => {
    const { service } = makeDeps({
      policy: { ...POLICY, issuedPremium: null },
    });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s when the placed quotation captured no commission rate', async () => {
    const { service } = makeDeps({ rate: null });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s when tax exceeds the premium', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), taxAmount: '1000.001' }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when fees exceed the premium', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), feesAmount: '5000.000' }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the due date is in the past', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), dueDate: isoDaysAhead(-1) }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the due date is more than a year ahead', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), dueDate: isoDaysAhead(400) }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the placed commission rate is outside 0..100 (billing-time backstop)', async () => {
    const { service } = makeDeps({ rate: d('150') });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('is write-once: a byte-identical re-post returns the existing invoice without creating', async () => {
    const existing = {
      id: 'inv-existing',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000.000'),
      taxAmount: d('160.000'),
      feesAmount: d('25.000'),
      commissionDeducted: d('125.000'),
      totalAmount: d('1060.000'),
      currency: 'JOD',
      dueDate: new Date(`${isoDaysAhead(30)}T00:00:00.000Z`),
      status: 'INVOICED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    const { service, invoices } = makeDeps({ existing });
    const view = await service.create(dto(), actor);
    expect(view.id).toBe('inv-existing');
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('resumes a byte-identical re-post even after the stored due date has elapsed (resume runs before the window check)', async () => {
    const pastDue = isoDaysAhead(-5);
    const existing = {
      id: 'inv-existing',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000.000'),
      taxAmount: d('160.000'),
      feesAmount: d('25.000'),
      commissionDeducted: d('125.000'),
      totalAmount: d('1060.000'),
      currency: 'JOD',
      dueDate: new Date(`${pastDue}T00:00:00.000Z`),
      status: 'INVOICED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    const { service, invoices } = makeDeps({ existing });
    const view = await service.create({ ...dto(), dueDate: pastDue }, actor);
    expect(view.id).toBe('inv-existing');
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('409s when a premium invoice already exists with different figures', async () => {
    const existing = {
      id: 'inv-existing',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000.000'),
      taxAmount: d('160.000'),
      feesAmount: d('99.000'), // different
      commissionDeducted: d('125.000'),
      totalAmount: d('1134.000'),
      currency: 'JOD',
      dueDate: new Date(`${isoDaysAhead(30)}T00:00:00.000Z`),
      status: 'INVOICED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    const { service } = makeDeps({ existing });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps a concurrent P2002 to a 409', async () => {
    const { service, invoices } = makeDeps();
    invoices.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not fail the request if the audit write throws (already committed)', async () => {
    const { service, audit } = makeDeps();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.create(dto(), actor)).resolves.toMatchObject({
      id: 'inv-1',
    });
  });
});

describe('InvoiceService.list (Process 31)', () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it('400s when neither policyId nor customerId is given', async () => {
    await expect(deps.service.list({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lists by policyId', async () => {
    deps.invoices.findManyByPolicyId.mockResolvedValueOnce([
      {
        id: 'inv-1',
        policyId: 'pol-1',
        customerId: 'cust-1',
        invoiceType: 'new_business_premium',
        premiumAmount: d('1000'),
        taxAmount: d('0'),
        feesAmount: d('0'),
        commissionDeducted: d('125'),
        totalAmount: d('875'),
        currency: 'JOD',
        dueDate: new Date('2026-10-01T00:00:00.000Z'),
        status: 'INVOICED',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      },
    ]);
    const rows = await deps.service.list({ policyId: 'pol-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalAmount).toBe('875.000');
    expect(deps.invoices.findManyByCustomerId).not.toHaveBeenCalled();
  });
});
