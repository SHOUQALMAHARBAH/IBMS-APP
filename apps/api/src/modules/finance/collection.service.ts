import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  InvoiceRepository,
  type InvoiceWithCycle,
} from '../../repositories/invoice.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
  sumMoney,
} from '../../common/money.util';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import type { RecordReceiptDto } from './dto/record-receipt.dto';
import type { RecordRemittanceDto } from './dto/record-remittance.dto';
import {
  clientFundsLedgerAuditSnapshot,
  computeRemittanceAmount,
  deriveInvoiceView,
  receiptAuditSnapshot,
  remittanceAuditSnapshot,
  type InvoiceView,
} from './finance.config';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 32 — Collection (backlog Part C #32, Domain D). Drives one invoice
 * through the collection cycle:
 *
 *   INVOICED --(receipt)--> COLLECTED --(reconcile)--> RECONCILED
 *          --(remittance)--> REMITTED
 *
 * Every `Invoice` status move goes through `WorkflowTransitionService.transition`
 * (the status-conditional `updateMany` is the race gate); the `Receipt` /
 * `Remittance` / `ClientFundsLedgerEntry` artefacts are written AFTER the
 * transition commits (the #24 register pattern), each in one `$transaction`
 * with its client-money ledger row. #32 supports a single full-payment receipt
 * per invoice — a partial / over payment is a 422 (the variance path is
 * Process 39, never a silent write-off — `money-decimal-jod.md`).
 *
 * No maker/checker — recording a receipt / remittance is single-actor Finance
 * work (`roles-and-segregation-of-duties.md` lists both as Finance/Collections
 * single-actor duties; the Finance maker/checker pair is refunds / write-offs).
 * Book-wide (`receipt.record` / `remittance.record` are Finance permissions —
 * no per-owner filter, same as #31).
 */
@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly policies: PolicyRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. Collection / Receipt (INVOICED -> COLLECTED) --------------------

  async recordReceipt(
    invoiceId: string,
    dto: RecordReceiptDto,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    let invoice = await this.loadInvoice(invoiceId);
    const amount = quantizeMoney(dto.amount);
    const method = dto.method ?? null;
    const receivedAt = dto.receivedAt
      ? parseHistoricalInstant(dto.receivedAt, 'receivedAt')
      : new Date();

    const existingReceipt = invoice.receipts[0];
    if (existingReceipt) {
      // A receipt exists => the INVOICED -> COLLECTED transition already
      // committed. A byte-identical re-post is an idempotent no-op; any
      // different amount / method is a 409 (recorded once — no amend path).
      const same =
        compareMoney(existingReceipt.amount, amount) === 0 &&
        (existingReceipt.method ?? null) === method;
      if (!same) {
        throw new ConflictException(
          `Invoice ${invoiceId} already has a collection receipt (${formatMoney(
            existingReceipt.amount,
          )}). Receipts are recorded once — a correction is not yet supported.`,
        );
      }
      return deriveInvoiceView(invoice);
    }

    // No receipt yet. The exact-amount rule is the loud "never a silent
    // write-off" gate (money-decimal-jod.md) — checked before the transition.
    if (compareMoney(amount, invoice.totalAmount) !== 0) {
      throw new UnprocessableEntityException(
        `amount (${formatMoney(amount)}) must equal the invoiced total (${formatMoney(
          invoice.totalAmount,
        )}). A partial or over payment is a variance — record it through Process 39, not here.`,
      );
    }

    if (invoice.status === 'INVOICED') {
      try {
        await this.workflow.transition({
          entityType: 'Invoice',
          entityId: invoiceId,
          toStatus: 'COLLECTED',
          actorUserId: actor.id,
        });
      } catch (err) {
        // INVOICED -> COLLECTED is a legal edge and the invoice was INVOICED a
        // moment ago, so the only failures are a concurrent receipt winning
        // the race (0-rows ConflictException, or the engine's "already in
        // status COLLECTED"). Reload and handle it as an already-collected
        // invoice.
        invoice = await this.loadInvoice(invoiceId);
        if (invoice.status === 'INVOICED') throw err;
        return this.finishReceipt(invoice, amount, method, receivedAt, actor);
      }
      invoice = await this.loadInvoice(invoiceId);
      return this.finishReceipt(invoice, amount, method, receivedAt, actor);
    }

    if (invoice.status === 'COLLECTED') {
      // Crash-recovery re-entry: the transition committed but the receipt
      // write did not. Resume it without re-transitioning.
      this.logger.warn(
        `Invoice ${invoiceId}: resuming a partially-completed receipt (status COLLECTED, no receipt row).`,
      );
      return this.finishReceipt(invoice, amount, method, receivedAt, actor);
    }

    throw new UnprocessableEntityException(
      `Invoice ${invoiceId} is ${invoice.status}; a collection receipt is recorded while it is INVOICED.`,
    );
  }

  private async finishReceipt(
    invoice: InvoiceWithCycle,
    amount: Prisma.Decimal,
    method: string | null,
    receivedAt: Date,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    if (invoice.receipts[0]) {
      // Another concurrent caller wrote the receipt between our transition and
      // here — byte-identical is fine, anything else is a 409.
      const existing = invoice.receipts[0];
      const same =
        compareMoney(existing.amount, amount) === 0 &&
        (existing.method ?? null) === method;
      if (!same) {
        throw new ConflictException(
          `Invoice ${invoice.id} already has a collection receipt (created concurrently with different figures).`,
        );
      }
      return deriveInvoiceView(invoice);
    }

    let created: Awaited<
      ReturnType<InvoiceRepository['recordReceiptWithLedger']>
    >;
    try {
      created = await this.invoices.recordReceiptWithLedger({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        method,
        receivedAt,
        ledgerReference: `invoice:${invoice.id}`,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // `Receipt.invoiceId @unique` fired — a concurrent caller's receipt
        // committed between our `receipts[0]` read above and this write (it
        // lost the transition race but still reached here before we did). A
        // byte-identical race is an idempotent resume; a genuinely different
        // amount / method is a 409. This is the "the write re-asserts the
        // condition" half of race-safe-invariants.md.
        const now = await this.loadInvoice(invoice.id);
        const landed = now.receipts[0];
        if (
          landed &&
          compareMoney(landed.amount, amount) === 0 &&
          (landed.method ?? null) === method
        ) {
          return deriveInvoiceView(now);
        }
        throw new ConflictException(
          `Invoice ${invoice.id} already has a collection receipt with different figures (created concurrently).`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Receipt',
      entityId: created.receipt.id,
      afterValue: receiptAuditSnapshot({
        receiptId: created.receipt.id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: created.receipt.amount,
        method: created.receipt.method,
        receivedAt: created.receipt.receivedAt,
      }),
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ClientFundsLedgerEntry',
      entityId: created.ledgerEntry.id,
      afterValue: clientFundsLedgerAuditSnapshot({
        entryId: created.ledgerEntry.id,
        customerId: created.ledgerEntry.customerId,
        amount: created.ledgerEntry.amount,
        direction: created.ledgerEntry.direction,
        reference: created.ledgerEntry.reference,
      }),
    });

    return deriveInvoiceView(await this.loadInvoice(invoice.id));
  }

  // --- 2. Reconciliation (COLLECTED -> RECONCILED) -----------------------

  async reconcile(
    invoiceId: string,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    let invoice = await this.loadInvoice(invoiceId);

    if (invoice.status === 'RECONCILED' || invoice.status === 'REMITTED') {
      return deriveInvoiceView(invoice); // idempotent
    }
    if (invoice.status !== 'COLLECTED') {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} is ${invoice.status}; reconciliation follows a recorded collection (COLLECTED).`,
      );
    }

    // Re-derive the collected total from the live receipt rows (never a stored
    // snapshot — the #16 "re-check the gate at the decision point" rule).
    const collected = sumMoney(invoice.receipts.map((r) => r.amount));
    if (compareMoney(collected, invoice.totalAmount) !== 0) {
      throw new UnprocessableEntityException(
        `Collected ${formatMoney(collected)} does not reconcile to the invoiced ${formatMoney(
          invoice.totalAmount,
        )} — raise the variance through Process 39, never write it off here.`,
      );
    }

    try {
      await this.workflow.transition({
        entityType: 'Invoice',
        entityId: invoiceId,
        toStatus: 'RECONCILED',
        actorUserId: actor.id,
      });
    } catch (err) {
      invoice = await this.loadInvoice(invoiceId);
      if (invoice.status === 'RECONCILED' || invoice.status === 'REMITTED') {
        return deriveInvoiceView(invoice);
      }
      throw err;
    }

    return deriveInvoiceView(await this.loadInvoice(invoiceId));
  }

  // --- 3. Remittance (RECONCILED -> REMITTED) --------------------------

  async recordRemittance(
    invoiceId: string,
    dto: RecordRemittanceDto,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    let invoice = await this.loadInvoice(invoiceId);
    const remittedAt = dto.remittedAt
      ? parseHistoricalInstant(dto.remittedAt, 'remittedAt')
      : new Date();

    if (invoice.policyId == null) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} is not tied to a policy — there is no insurer to remit to.`,
      );
    }
    const policy = await this.policies.findById(invoice.policyId);
    if (!policy) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId}: its policy ${invoice.policyId} was not found.`,
      );
    }
    const insurerId = policy.insurerId;
    const amount = computeRemittanceAmount(
      invoice.premiumAmount,
      invoice.commissionDeducted,
    );
    if (amount.lessThan(0)) {
      throw new UnprocessableEntityException(
        `The net remittance would be negative (${formatMoney(amount)}) — check the commission.`,
      );
    }

    const receipt = invoice.receipts[0];
    if (!receipt) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} has no recorded collection — collect and reconcile it before remitting.`,
      );
    }

    if (receipt.remittance) {
      // Deterministic (amount + insurer both derived) — a re-post always
      // matches, so this is an idempotent no-op. A stored figure that somehow
      // disagrees is a 409, not a silent resume.
      const same =
        compareMoney(receipt.remittance.amount, amount) === 0 &&
        receipt.remittance.insurerId === insurerId;
      if (!same) {
        throw new ConflictException(
          `Invoice ${invoiceId} already has a remittance recorded with different figures.`,
        );
      }
      return deriveInvoiceView(invoice);
    }

    if (invoice.status === 'RECONCILED') {
      try {
        await this.workflow.transition({
          entityType: 'Invoice',
          entityId: invoiceId,
          toStatus: 'REMITTED',
          actorUserId: actor.id,
        });
      } catch (err) {
        invoice = await this.loadInvoice(invoiceId);
        if (invoice.status !== 'REMITTED') throw err;
        return this.finishRemittance(
          invoice,
          receipt.id,
          insurerId,
          amount,
          remittedAt,
          actor,
        );
      }
      invoice = await this.loadInvoice(invoiceId);
      return this.finishRemittance(
        invoice,
        receipt.id,
        insurerId,
        amount,
        remittedAt,
        actor,
      );
    }

    if (invoice.status === 'REMITTED') {
      this.logger.warn(
        `Invoice ${invoiceId}: resuming a partially-completed remittance (status REMITTED, no remittance row).`,
      );
      return this.finishRemittance(
        invoice,
        receipt.id,
        insurerId,
        amount,
        remittedAt,
        actor,
      );
    }

    throw new UnprocessableEntityException(
      `Invoice ${invoiceId} is ${invoice.status}; a remittance follows reconciliation (RECONCILED).`,
    );
  }

  private async finishRemittance(
    invoice: InvoiceWithCycle,
    receiptId: string,
    insurerId: string,
    amount: Prisma.Decimal,
    remittedAt: Date,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    if (invoice.receipts[0]?.remittance) {
      return deriveInvoiceView(invoice); // concurrent write landed first
    }

    let created: Awaited<
      ReturnType<InvoiceRepository['recordRemittanceWithLedger']>
    >;
    try {
      created = await this.invoices.recordRemittanceWithLedger({
        receiptId,
        customerId: invoice.customerId,
        insurerId,
        amount,
        remittedAt,
        ledgerReference: `invoice:${invoice.id}`,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // `Remittance.receiptId @unique` fired — a concurrent caller's
        // remittance committed first. The figures are deterministic (net
        // premium + the policy's insurer), so this is always a byte-identical
        // race: resume with the landed remittance.
        return deriveInvoiceView(await this.loadInvoice(invoice.id));
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Remittance',
      entityId: created.remittance.id,
      afterValue: remittanceAuditSnapshot({
        remittanceId: created.remittance.id,
        receiptId,
        invoiceId: invoice.id,
        insurerId,
        amount: created.remittance.amount,
        remittedAt: created.remittance.remittedAt,
      }),
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ClientFundsLedgerEntry',
      entityId: created.ledgerEntry.id,
      afterValue: clientFundsLedgerAuditSnapshot({
        entryId: created.ledgerEntry.id,
        customerId: created.ledgerEntry.customerId,
        amount: created.ledgerEntry.amount,
        direction: created.ledgerEntry.direction,
        reference: created.ledgerEntry.reference,
      }),
    });

    return deriveInvoiceView(await this.loadInvoice(invoice.id));
  }

  // --- helpers ----------------------------------------------------------

  private async loadInvoice(id: string): Promise<InvoiceWithCycle> {
    const invoice = await this.invoices.findById(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found.`);
    }
    return invoice;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Collection audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}
