import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CollectionService } from './collection.service';
import type {
  InvoiceRepository,
  InvoiceWithCycle,
} from '../../repositories/invoice.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const d = (s: string) => new Prisma.Decimal(s);

const actor: AuthenticatedUser = {
  id: 'fin-1',
  email: 'finance@ibms.test',
  roles: ['FINANCE_COLLECTIONS_OFFICER'],
  sessionId: 's-1',
};

type ReceiptFixture = InvoiceWithCycle['receipts'][number];

function invoiceFixture(over?: {
  status?: string;
  policyId?: string | null;
  receipts?: ReceiptFixture[];
}): InvoiceWithCycle {
  return {
    id: 'inv-1',
    policyId: over?.policyId === undefined ? 'pol-1' : over.policyId,
    customerId: 'cust-1',
    invoiceType: 'new_business_premium',
    premiumAmount: d('120000.000'),
    taxAmount: d('9600.000'),
    feesAmount: d('150.000'),
    commissionDeducted: d('14400.000'),
    totalAmount: d('115350.000'),
    currency: 'JOD',
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
    status: (over?.status ?? 'INVOICED') as InvoiceWithCycle['status'],
    createdAt: new Date('2026-09-16T00:00:00.000Z'),
    receipts: over?.receipts ?? [],
  };
}

function receiptFixture(over?: Partial<ReceiptFixture>): ReceiptFixture {
  return {
    id: 'rcpt-1',
    invoiceId: 'inv-1',
    amount: d('115350.000'),
    method: 'bank_transfer',
    receivedAt: new Date('2026-09-20T00:00:00.000Z'),
    remittance: null,
    ...over,
  };
}

function makeDeps(sequence: InvoiceWithCycle[]) {
  // `findById` returns the next fixture in `sequence` on each call (the
  // service reloads after each transition).
  let i = 0;
  const invoices = {
    findById: vi.fn(() =>
      Promise.resolve(sequence[Math.min(i++, sequence.length - 1)]),
    ),
    recordReceiptWithLedger: vi.fn(() =>
      Promise.resolve({
        receipt: receiptFixture(),
        ledgerEntry: {
          id: 'led-in-1',
          customerId: 'cust-1',
          amount: d('115350.000'),
          direction: 'in',
          reference: 'invoice:inv-1',
          recordedAt: new Date(),
        },
      }),
    ),
    recordRemittanceWithLedger: vi.fn(() =>
      Promise.resolve({
        remittance: {
          id: 'rem-1',
          receiptId: 'rcpt-1',
          insurerId: 'ins-1',
          amount: d('105600.000'),
          remittedAt: new Date('2026-09-25T00:00:00.000Z'),
        },
        ledgerEntry: {
          id: 'led-out-1',
          customerId: 'cust-1',
          amount: d('105600.000'),
          direction: 'out',
          reference: 'invoice:inv-1',
          recordedAt: new Date(),
        },
      }),
    ),
  };
  const policies = {
    findById: vi.fn(() => Promise.resolve({ id: 'pol-1', insurerId: 'ins-1' })),
  };
  const workflow = {
    transition: vi.fn(() => Promise.resolve({ id: 'inv-1', status: 'x' })),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CollectionService(
    invoices as unknown as InvoiceRepository,
    policies as unknown as PolicyRepository,
    workflow as unknown as WorkflowTransitionService,
    audit as unknown as AuditService,
  );
  return { service, invoices, policies, workflow, audit };
}

describe('CollectionService.recordReceipt (Process 32)', () => {
  it('drives INVOICED -> COLLECTED, records the receipt + an "in" ledger entry, and audits', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'INVOICED' }),
      invoiceFixture({ status: 'COLLECTED' }),
      invoiceFixture({ status: 'COLLECTED', receipts: [receiptFixture()] }),
    ]);
    const view = await deps.service.recordReceipt(
      'inv-1',
      { amount: '115350.000', method: 'bank_transfer' },
      actor,
    );
    expect(deps.workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Invoice', toStatus: 'COLLECTED' }),
    );
    expect(deps.invoices.recordReceiptWithLedger).toHaveBeenCalledWith(
      expect.objectContaining({ ledgerReference: 'invoice:inv-1' }),
    );
    const actions = deps.audit.record.mock.calls.map(
      (c) => (c[0] as { entityType: string }).entityType,
    );
    expect(actions).toContain('Receipt');
    expect(actions).toContain('ClientFundsLedgerEntry');
    expect(view.status).toBe('COLLECTED');
    expect(view.receipt?.amount).toBe('115350.000');
  });

  it('422s when the amount does not equal the invoiced total (a variance is Process 39)', async () => {
    const deps = makeDeps([invoiceFixture({ status: 'INVOICED' })]);
    await expect(
      deps.service.recordReceipt('inv-1', { amount: '100000.000' }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.workflow.transition).not.toHaveBeenCalled();
  });

  it('422s when the invoice is already past collection', async () => {
    const deps = makeDeps([invoiceFixture({ status: 'RECONCILED' })]);
    await expect(
      deps.service.recordReceipt('inv-1', { amount: '115350.000' }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('is idempotent: a byte-identical re-post of an existing receipt returns the view without re-transitioning', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'COLLECTED', receipts: [receiptFixture()] }),
    ]);
    const view = await deps.service.recordReceipt(
      'inv-1',
      { amount: '115350.000', method: 'bank_transfer' },
      actor,
    );
    expect(view.status).toBe('COLLECTED');
    expect(deps.workflow.transition).not.toHaveBeenCalled();
    expect(deps.invoices.recordReceiptWithLedger).not.toHaveBeenCalled();
  });

  it('409s when a receipt already exists with a different amount', async () => {
    const deps = makeDeps([
      invoiceFixture({
        status: 'COLLECTED',
        receipts: [receiptFixture({ amount: d('999.000') })],
      }),
    ]);
    await expect(
      deps.service.recordReceipt('inv-1', { amount: '115350.000' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resumes a crash between the transition and the receipt write (COLLECTED, no receipt) without re-transitioning', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'COLLECTED' }),
      invoiceFixture({ status: 'COLLECTED', receipts: [receiptFixture()] }),
    ]);
    const view = await deps.service.recordReceipt(
      'inv-1',
      { amount: '115350.000', method: 'bank_transfer' },
      actor,
    );
    expect(deps.workflow.transition).not.toHaveBeenCalled();
    expect(deps.invoices.recordReceiptWithLedger).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('COLLECTED');
  });

  it('a lost P2002 race on the Receipt.invoiceId UNIQUE resumes when the landed receipt is byte-identical', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'INVOICED' }),
      invoiceFixture({ status: 'COLLECTED' }), // post-transition reload, no receipt yet
      invoiceFixture({ status: 'COLLECTED', receipts: [receiptFixture()] }), // the winner's row landed
    ]);
    deps.invoices.recordReceiptWithLedger.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    const view = await deps.service.recordReceipt(
      'inv-1',
      { amount: '115350.000', method: 'bank_transfer' },
      actor,
    );
    expect(view.status).toBe('COLLECTED');
    expect(view.receipt?.amount).toBe('115350.000');
  });

  it('a lost P2002 race whose landed receipt differs is a 409', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'INVOICED' }),
      invoiceFixture({ status: 'COLLECTED' }),
      invoiceFixture({
        status: 'COLLECTED',
        receipts: [receiptFixture({ amount: d('999.000') })],
      }),
    ]);
    deps.invoices.recordReceiptWithLedger.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      deps.service.recordReceipt(
        'inv-1',
        { amount: '115350.000', method: 'bank_transfer' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown invoice', async () => {
    const deps = makeDeps([]);
    deps.invoices.findById.mockResolvedValueOnce(
      undefined as unknown as InvoiceWithCycle,
    );
    await expect(
      deps.service.recordReceipt('nope', { amount: '1.000' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CollectionService.reconcile (Process 32)', () => {
  it('drives COLLECTED -> RECONCILED once the receipts reconcile to the total', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'COLLECTED', receipts: [receiptFixture()] }),
      invoiceFixture({ status: 'RECONCILED', receipts: [receiptFixture()] }),
    ]);
    const view = await deps.service.reconcile('inv-1', actor);
    expect(deps.workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'RECONCILED' }),
    );
    expect(view.status).toBe('RECONCILED');
  });

  it('is an idempotent no-op when already RECONCILED', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'RECONCILED', receipts: [receiptFixture()] }),
    ]);
    const view = await deps.service.reconcile('inv-1', actor);
    expect(view.status).toBe('RECONCILED');
    expect(deps.workflow.transition).not.toHaveBeenCalled();
  });

  it('422s when the invoice has not been collected', async () => {
    const deps = makeDeps([invoiceFixture({ status: 'INVOICED' })]);
    await expect(deps.service.reconcile('inv-1', actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s a variance rather than writing it off', async () => {
    const deps = makeDeps([
      invoiceFixture({
        status: 'COLLECTED',
        receipts: [receiptFixture({ amount: d('100000.000') })],
      }),
    ]);
    await expect(deps.service.reconcile('inv-1', actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(deps.workflow.transition).not.toHaveBeenCalled();
  });
});

describe('CollectionService.recordRemittance (Process 32)', () => {
  it('computes premium - commission, drives RECONCILED -> REMITTED, and books an "out" ledger entry', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'RECONCILED', receipts: [receiptFixture()] }),
      invoiceFixture({ status: 'REMITTED', receipts: [receiptFixture()] }),
      invoiceFixture({
        status: 'REMITTED',
        receipts: [
          receiptFixture({
            remittance: {
              id: 'rem-1',
              receiptId: 'rcpt-1',
              insurerId: 'ins-1',
              amount: d('105600.000'),
              remittedAt: new Date('2026-09-25T00:00:00.000Z'),
            },
          }),
        ],
      }),
    ]);
    const view = await deps.service.recordRemittance('inv-1', {}, actor);
    const remitCalls = deps.invoices.recordRemittanceWithLedger.mock
      .calls as unknown as Array<
      [{ insurerId: string; amount: Prisma.Decimal; ledgerReference: string }]
    >;
    const arg = remitCalls[0][0];
    expect(arg.insurerId).toBe('ins-1');
    expect(arg.ledgerReference).toBe('invoice:inv-1');
    expect(arg.amount.toFixed(3)).toBe('105600.000'); // 120000 - 14400
    expect(view.status).toBe('REMITTED');
    expect(view.remittance?.amount).toBe('105600.000');
  });

  it('422s a non-policy invoice — no insurer to remit to', async () => {
    const deps = makeDeps([
      invoiceFixture({
        status: 'RECONCILED',
        policyId: null,
        receipts: [receiptFixture()],
      }),
    ]);
    await expect(
      deps.service.recordRemittance('inv-1', {}, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the invoice is not yet reconciled', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'COLLECTED', receipts: [receiptFixture()] }),
    ]);
    await expect(
      deps.service.recordRemittance('inv-1', {}, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('is an idempotent no-op when the remittance already exists (figures match)', async () => {
    const deps = makeDeps([
      invoiceFixture({
        status: 'REMITTED',
        receipts: [
          receiptFixture({
            remittance: {
              id: 'rem-1',
              receiptId: 'rcpt-1',
              insurerId: 'ins-1',
              amount: d('105600.000'),
              remittedAt: new Date('2026-09-25T00:00:00.000Z'),
            },
          }),
        ],
      }),
    ]);
    const view = await deps.service.recordRemittance('inv-1', {}, actor);
    expect(view.status).toBe('REMITTED');
    expect(deps.workflow.transition).not.toHaveBeenCalled();
    expect(deps.invoices.recordRemittanceWithLedger).not.toHaveBeenCalled();
  });

  it('409s when a stored remittance disagrees on the figures', async () => {
    const deps = makeDeps([
      invoiceFixture({
        status: 'REMITTED',
        receipts: [
          receiptFixture({
            remittance: {
              id: 'rem-1',
              receiptId: 'rcpt-1',
              insurerId: 'ins-1',
              amount: d('999.000'),
              remittedAt: new Date('2026-09-25T00:00:00.000Z'),
            },
          }),
        ],
      }),
    ]);
    await expect(
      deps.service.recordRemittance('inv-1', {}, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resumes a crash between the transition and the remittance write (REMITTED, no remittance)', async () => {
    const deps = makeDeps([
      invoiceFixture({ status: 'REMITTED', receipts: [receiptFixture()] }),
      invoiceFixture({
        status: 'REMITTED',
        receipts: [
          receiptFixture({
            remittance: {
              id: 'rem-1',
              receiptId: 'rcpt-1',
              insurerId: 'ins-1',
              amount: d('105600.000'),
              remittedAt: new Date('2026-09-25T00:00:00.000Z'),
            },
          }),
        ],
      }),
    ]);
    const view = await deps.service.recordRemittance('inv-1', {}, actor);
    expect(deps.workflow.transition).not.toHaveBeenCalled();
    expect(deps.invoices.recordRemittanceWithLedger).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('REMITTED');
  });

  it('a lost P2002 race on the Remittance.receiptId UNIQUE resumes (figures are deterministic)', async () => {
    const withRemittance = invoiceFixture({
      status: 'REMITTED',
      receipts: [
        receiptFixture({
          remittance: {
            id: 'rem-1',
            receiptId: 'rcpt-1',
            insurerId: 'ins-1',
            amount: d('105600.000'),
            remittedAt: new Date('2026-09-25T00:00:00.000Z'),
          },
        }),
      ],
    });
    const deps = makeDeps([
      invoiceFixture({ status: 'RECONCILED', receipts: [receiptFixture()] }),
      invoiceFixture({ status: 'REMITTED', receipts: [receiptFixture()] }),
      withRemittance,
    ]);
    deps.invoices.recordRemittanceWithLedger.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    const view = await deps.service.recordRemittance('inv-1', {}, actor);
    expect(view.status).toBe('REMITTED');
    expect(view.remittance?.amount).toBe('105600.000');
  });
});
