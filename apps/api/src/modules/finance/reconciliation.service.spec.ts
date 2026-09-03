import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import type { ReconciliationRepository } from '../../repositories/reconciliation.repository';
import type { InvoiceRepository } from '../../repositories/invoice.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuditService } from '../audit/audit.service';

const d = (v: string) => new Prisma.Decimal(v);

/** An invoice as InvoiceRepository.findById returns it (only the fields the
 * service reads). premium 120000, commission 14400 -> broker record 105600. */
const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  policyId: 'pol-1',
  customerId: 'cust-1',
  premiumAmount: d('120000.000'),
  commissionDeducted: d('14400.000'),
  currency: 'JOD',
  status: 'RECONCILED',
  receipts: [],
  ...over,
});

const exceptionRow = (over: Record<string, unknown> = {}) => ({
  id: 're-1',
  invoiceId: 'inv-1',
  insurerStatementAmount: d('110600.000'),
  brokerRecordAmount: d('105600.000'),
  varianceAmount: d('5000.000'),
  status: 'open',
  raisedByUserId: 'fin-1',
  investigatedByUserId: null,
  resolvedByUserId: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: new Date('2026-09-03T10:00:00.000Z'),
  ...over,
});

function makeService(
  over: {
    exceptions?: Record<string, unknown>;
    invoices?: Record<string, unknown>;
  } = {},
) {
  const exceptions = {
    findOpenExceptionForInvoice: vi.fn().mockResolvedValue(null),
    createException: vi.fn().mockResolvedValue(exceptionRow()),
    findExceptionById: vi.fn().mockResolvedValue(exceptionRow()),
    findExceptions: vi.fn().mockResolvedValue([]),
    recordInvestigation: vi.fn().mockResolvedValue({ count: 1 }),
    recordResolution: vi.fn().mockResolvedValue({ count: 1 }),
    ...over.exceptions,
  };
  const invoices = {
    findById: vi.fn().mockResolvedValue(invoiceRow()),
    ...over.invoices,
  };
  const workflow = { transition: vi.fn().mockResolvedValue({ status: 'x' }) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ReconciliationService(
    exceptions as unknown as ReconciliationRepository,
    invoices as unknown as InvoiceRepository,
    workflow as unknown as WorkflowTransitionService,
    audit as unknown as AuditService,
  );
  return { service, exceptions, invoices, workflow, audit };
}

describe('ReconciliationService.detect (Process 39)', () => {
  it('a matching line reconciles silently — no exception', async () => {
    const { service, exceptions, workflow } = makeService();
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '105600.000' }] },
      'fin-1',
    );
    expect(r.reconciled).toBe(1);
    expect(r.exceptionsRaised).toBe(0);
    expect(r.results[0]).toMatchObject({
      outcome: 'reconciled',
      varianceAmount: '0.000',
    });
    expect(exceptions.createException).not.toHaveBeenCalled();
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('a non-zero variance ALWAYS raises an exception (exact amount) + drives the invoice to EXCEPTION_RAISED', async () => {
    const { service, exceptions, workflow, audit } = makeService();
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '110600.000' }] },
      'fin-1',
    );
    expect(r.exceptionsRaised).toBe(1);
    expect(r.results[0]).toMatchObject({
      outcome: 'exception_raised',
      exceptionId: 're-1',
      varianceAmount: '5000.000', // 110600 - 105600
    });
    const arg = exceptions.createException.mock.calls[0]?.[0] as {
      varianceAmount: Prisma.Decimal;
      raisedByUserId: string;
    };
    expect(arg.varianceAmount.toFixed(3)).toBe('5000.000');
    expect(arg.raisedByUserId).toBe('fin-1');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Invoice',
        entityId: 'inv-1',
        toStatus: 'EXCEPTION_RAISED',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'ReconciliationException',
      }),
    );
  });

  it('a negative variance still raises an exception', async () => {
    const { service, exceptions } = makeService({
      exceptions: {
        createException: vi.fn().mockResolvedValue(
          exceptionRow({
            insurerStatementAmount: d('100600.000'),
            varianceAmount: d('-5000.000'),
          }),
        ),
      },
    });
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '100600.000' }] },
      'fin-1',
    );
    expect(r.results[0]?.outcome).toBe('exception_raised');
    const arg = exceptions.createException.mock.calls[0]?.[0] as {
      varianceAmount: Prisma.Decimal;
    };
    expect(arg.varianceAmount.toFixed(3)).toBe('-5000.000');
  });

  it('records the exception but does NOT transition a REMITTED invoice', async () => {
    const { service, workflow } = makeService({
      invoices: {
        findById: vi.fn().mockResolvedValue(invoiceRow({ status: 'REMITTED' })),
      },
    });
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '110600.000' }] },
      'fin-1',
    );
    expect(r.results[0]?.outcome).toBe('exception_raised');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('an already-open exception with the same figures resolves to exception_exists (idempotent)', async () => {
    const { service, exceptions } = makeService({
      exceptions: {
        findOpenExceptionForInvoice: vi.fn().mockResolvedValue(exceptionRow()),
      },
    });
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '110600.000' }] },
      'fin-1',
    );
    expect(r.results[0]?.outcome).toBe('exception_exists');
    expect(exceptions.createException).not.toHaveBeenCalled();
  });

  it('an open exception with different figures flags conflicting_exception and reports THIS run’s fresh variance', async () => {
    const { service } = makeService({
      exceptions: {
        findOpenExceptionForInvoice: vi.fn().mockResolvedValue(
          exceptionRow({
            insurerStatementAmount: d('999.000'),
            varianceAmount: d('-104601.000'), // the OLD row's figure
          }),
        ),
      },
    });
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '110600.000' }] },
      'fin-1',
    );
    expect(r.results[0]?.outcome).toBe('conflicting_exception');
    // the fresh 110600 - 105600, NOT the standing row's -104601
    expect(r.results[0]?.varianceAmount).toBe('5000.000');
  });

  it('self-heals a missed EXCEPTION_RAISED hop on a same-figures re-detect', async () => {
    // the exception already exists (a prior detect raised it) but the invoice
    // is still RECONCILED — a best-effort transition that never landed
    const { service, workflow } = makeService({
      exceptions: {
        findOpenExceptionForInvoice: vi.fn().mockResolvedValue(exceptionRow()),
      },
      invoices: {
        findById: vi
          .fn()
          .mockResolvedValue(invoiceRow({ status: 'RECONCILED' })),
      },
    });
    const r = await service.detect(
      { lines: [{ invoiceId: 'inv-1', insurerStatementAmount: '110600.000' }] },
      'fin-1',
    );
    expect(r.results[0]?.outcome).toBe('exception_exists');
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'EXCEPTION_RAISED' }),
    );
  });

  it('flags an unknown invoice + a non-policy invoice without throwing the batch', async () => {
    const { service } = makeService({
      invoices: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(invoiceRow({ id: 'inv-2', policyId: null })),
      },
    });
    const r = await service.detect(
      {
        lines: [
          {
            invoiceId: '11111111-1111-4111-8111-111111111111',
            insurerStatementAmount: '1.000',
          },
          {
            invoiceId: '22222222-2222-4222-8222-222222222222',
            insurerStatementAmount: '2.000',
          },
        ],
      },
      'fin-1',
    );
    expect(r.results.map((x) => x.outcome)).toEqual([
      'invoice_not_found',
      'not_a_policy_invoice',
    ]);
  });

  it('422s a duplicate statement line for the same invoice', async () => {
    const { service } = makeService();
    await expect(
      service.detect(
        {
          lines: [
            { invoiceId: 'inv-1', insurerStatementAmount: '1.000' },
            { invoiceId: 'inv-1', insurerStatementAmount: '2.000' },
          ],
        },
        'fin-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ReconciliationService.investigate (Process 39)', () => {
  it('open -> investigating, stamps the investigator + a UPDATE audit row', async () => {
    const { service, exceptions, audit } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValueOnce(exceptionRow())
          .mockResolvedValue(
            exceptionRow({
              status: 'investigating',
              investigatedByUserId: 'fin-2',
            }),
          ),
      },
    });
    const v = await service.investigate('re-1', 'fin-2');
    expect(exceptions.recordInvestigation).toHaveBeenCalledWith(
      're-1',
      'fin-2',
    );
    expect(v.status).toBe('investigating');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });

  it('is idempotent on an already-investigating exception', async () => {
    const { service, exceptions } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValue(exceptionRow({ status: 'investigating' })),
      },
    });
    const v = await service.investigate('re-1', 'fin-9');
    expect(v.status).toBe('investigating');
    expect(exceptions.recordInvestigation).not.toHaveBeenCalled();
  });

  it('422s investigating an already-resolved exception', async () => {
    const { service } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValue(exceptionRow({ status: 'resolved' })),
      },
    });
    await expect(service.investigate('re-1', 'fin-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('404s an unknown exception', async () => {
    const { service } = makeService({
      exceptions: { findExceptionById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.investigate('nope', 'fin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ReconciliationService.resolve (Process 39)', () => {
  const NOTE = 'Insurer statement double-counted a prior part-remittance.';

  it('resolves + drives the invoice EXCEPTION_RAISED -> EXCEPTION_RESOLVED -> RECONCILED (two hops)', async () => {
    const { service, exceptions, workflow, audit } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValueOnce(exceptionRow({ status: 'investigating' }))
          .mockResolvedValue(
            exceptionRow({
              status: 'resolved',
              resolutionNote: NOTE,
              resolvedByUserId: 'mgr-1',
            }),
          ),
      },
      invoices: {
        // initial read: EXCEPTION_RAISED; mid-hop re-read: EXCEPTION_RESOLVED
        findById: vi
          .fn()
          .mockResolvedValueOnce(invoiceRow({ status: 'EXCEPTION_RAISED' }))
          .mockResolvedValue(invoiceRow({ status: 'EXCEPTION_RESOLVED' })),
      },
    });
    const v = await service.resolve(
      're-1',
      { resolutionNote: NOTE, resumeInvoiceAs: 'RECONCILED' },
      'mgr-1',
    );
    expect(v.status).toBe('resolved');
    const targets = workflow.transition.mock.calls.map(
      (c) => (c[0] as { toStatus: string }).toStatus,
    );
    expect(targets).toEqual(['EXCEPTION_RESOLVED', 'RECONCILED']);
    expect(exceptions.recordResolution).toHaveBeenCalledWith(
      're-1',
      expect.objectContaining({
        resolutionNote: NOTE,
        resolvedByUserId: 'mgr-1',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });

  it('takes no last hop when a concurrent resolve already carried the invoice past EXCEPTION_RESOLVED', async () => {
    const { service, workflow } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValueOnce(exceptionRow({ status: 'investigating' }))
          .mockResolvedValue(
            exceptionRow({ status: 'resolved', resolutionNote: NOTE }),
          ),
      },
      invoices: {
        // initial: EXCEPTION_RAISED; mid-hop re-read: already RECONCILED (raced)
        findById: vi
          .fn()
          .mockResolvedValueOnce(invoiceRow({ status: 'EXCEPTION_RAISED' }))
          .mockResolvedValue(invoiceRow({ status: 'RECONCILED' })),
      },
    });
    const v = await service.resolve(
      're-1',
      { resolutionNote: NOTE, resumeInvoiceAs: 'RECONCILED' },
      'fin-1',
    );
    expect(v.status).toBe('resolved');
    const targets = workflow.transition.mock.calls.map(
      (c) => (c[0] as { toStatus: string }).toStatus,
    );
    expect(targets).toEqual(['EXCEPTION_RESOLVED']); // last hop skipped, no 422
  });

  it('resolves without an invoice transition when the invoice is not mid-exception', async () => {
    const { service, workflow } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValueOnce(exceptionRow({ status: 'open' }))
          .mockResolvedValue(
            exceptionRow({ status: 'resolved', resolutionNote: NOTE }),
          ),
      },
      invoices: {
        findById: vi.fn().mockResolvedValue(invoiceRow({ status: 'REMITTED' })),
      },
    });
    const v = await service.resolve('re-1', { resolutionNote: NOTE }, 'fin-1');
    expect(v.status).toBe('resolved');
    expect(workflow.transition).not.toHaveBeenCalled();
  });

  it('422s when the invoice is EXCEPTION_RAISED but resumeInvoiceAs is omitted', async () => {
    const { service } = makeService({
      invoices: {
        findById: vi
          .fn()
          .mockResolvedValue(invoiceRow({ status: 'EXCEPTION_RAISED' })),
      },
    });
    await expect(
      service.resolve('re-1', { resolutionNote: NOTE }, 'fin-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('runs only the last hop when the invoice is already EXCEPTION_RESOLVED (crash re-entry)', async () => {
    const { service, workflow } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValueOnce(exceptionRow({ status: 'investigating' }))
          .mockResolvedValue(
            exceptionRow({ status: 'resolved', resolutionNote: NOTE }),
          ),
      },
      invoices: {
        findById: vi
          .fn()
          .mockResolvedValue(invoiceRow({ status: 'EXCEPTION_RESOLVED' })),
      },
    });
    await service.resolve(
      're-1',
      { resolutionNote: NOTE, resumeInvoiceAs: 'RECONCILED' },
      'fin-1',
    );
    const targets = workflow.transition.mock.calls.map(
      (c) => (c[0] as { toStatus: string }).toStatus,
    );
    expect(targets).toEqual(['RECONCILED']);
  });

  it('is idempotent when re-resolved with the same note; 409 on a different note', async () => {
    const { service } = makeService({
      exceptions: {
        findExceptionById: vi
          .fn()
          .mockResolvedValue(
            exceptionRow({ status: 'resolved', resolutionNote: NOTE }),
          ),
      },
    });
    const v = await service.resolve('re-1', { resolutionNote: NOTE }, 'fin-2');
    expect(v.status).toBe('resolved');
    await expect(
      service.resolve(
        're-1',
        { resolutionNote: 'a totally different reason here' },
        'fin-2',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
