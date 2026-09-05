import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { PaymentChannel } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  InvoiceRepository,
  type InvoiceWithCycle,
} from '../../repositories/invoice.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { PaymentChannelRepository } from '../../repositories/payment-channel.repository';
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
    private readonly channels: PaymentChannelRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Process 38 — load an optional payment channel by id. A truly-unknown id is
   * a 404 whether the caller is creating or replaying an existing receipt /
   * remittance. Owner / status / currency / method checks are
   * `assert*ChannelUsable` — run **only on the create path**, AFTER the
   * write-once resume check, so an idempotent retry after the channel was later
   * disabled still resumes rather than 422-ing (the #31 "resume check before
   * the input-bound checks" ordering; same as #28 `recordSettlement`).
   */
  private async loadChannel(
    paymentChannelId: string | undefined,
  ): Promise<PaymentChannel | null> {
    if (!paymentChannelId) return null;
    const channel = await this.channels.findById(paymentChannelId);
    if (!channel) {
      throw new NotFoundException(
        `Payment channel ${paymentChannelId} not found.`,
      );
    }
    return channel;
  }

  /** The `Receipt.method` a supplied channel implies (its `channelType`), or
   * the caller's free `method` when no channel was supplied. Pure. */
  private receiptMethodFor(
    channel: PaymentChannel | null,
    callerMethod: string | null,
  ): string | null {
    return channel ? channel.channelType : callerMethod;
  }

  /** Process 38 — a supplied channel must be `active`, owned by the invoice's
   * customer, in the invoice currency, and not contradict an explicit caller
   * `method`. Called only when a NEW receipt is about to be written. */
  private assertReceiptChannelUsable(
    channel: PaymentChannel,
    invoice: InvoiceWithCycle,
    callerMethod: string | null,
  ): void {
    if (
      channel.ownerType !== 'customer' ||
      channel.customerId !== invoice.customerId
    ) {
      throw new UnprocessableEntityException(
        `Payment channel ${channel.id} does not belong to this invoice's customer.`,
      );
    }
    if (channel.status !== 'active') {
      throw new UnprocessableEntityException(
        `Payment channel ${channel.id} is disabled.`,
      );
    }
    if (channel.currency !== invoice.currency) {
      throw new UnprocessableEntityException(
        `Payment channel ${channel.id} is a ${channel.currency} channel; this invoice is ${invoice.currency}.`,
      );
    }
    if (callerMethod !== null && callerMethod !== channel.channelType) {
      throw new UnprocessableEntityException(
        `method "${callerMethod}" conflicts with payment channel ${channel.id} (${channel.channelType}) — omit method, it is derived from the channel.`,
      );
    }
  }

  /** Process 38 — a supplied remittance channel must be `active`, owned by the
   * policy's insurer, and in the invoice currency. Create path only. */
  private assertRemittanceChannelUsable(
    channel: PaymentChannel,
    insurerId: string,
    currency: string,
  ): void {
    if (channel.ownerType !== 'insurer' || channel.insurerId !== insurerId) {
      throw new UnprocessableEntityException(
        `Payment channel ${channel.id} does not belong to this policy's insurer.`,
      );
    }
    if (channel.status !== 'active') {
      throw new UnprocessableEntityException(
        `Payment channel ${channel.id} is disabled.`,
      );
    }
    if (channel.currency !== currency) {
      throw new UnprocessableEntityException(
        `Payment channel ${channel.id} is a ${channel.currency} channel; this invoice is ${currency}.`,
      );
    }
  }

  // --- 1. Collection / Receipt (INVOICED -> COLLECTED) --------------------

  async recordReceipt(
    invoiceId: string,
    dto: RecordReceiptDto,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    let invoice = await this.loadInvoice(invoiceId);
    const amount = quantizeMoney(dto.amount);
    // Load-only (404 on an unknown id) — the usability checks come after the
    // write-once resume, so a retry after the channel was disabled still resumes.
    const channel = await this.loadChannel(dto.paymentChannelId);
    const paymentChannelId = channel?.id ?? null;
    const method = this.receiptMethodFor(channel, dto.method ?? null);
    const receivedAt = dto.receivedAt
      ? parseHistoricalInstant(dto.receivedAt, 'receivedAt')
      : new Date();

    const existingReceipt = invoice.receipts[0];
    if (existingReceipt) {
      // A receipt exists => the INVOICED -> COLLECTED transition already
      // committed. A byte-identical re-post is an idempotent no-op; any
      // different amount / method / channel is a 409 (recorded once — no amend
      // path).
      const same =
        compareMoney(existingReceipt.amount, amount) === 0 &&
        (existingReceipt.method ?? null) === method &&
        (existingReceipt.paymentChannelId ?? null) === paymentChannelId;
      if (!same) {
        throw new ConflictException(
          `Invoice ${invoiceId} already has a collection receipt (${formatMoney(
            existingReceipt.amount,
          )}). Receipts are recorded once — a correction is not yet supported.`,
        );
      }
      return deriveInvoiceView(invoice);
    }

    // A NEW receipt — the supplied channel must be usable now.
    if (channel) {
      this.assertReceiptChannelUsable(channel, invoice, dto.method ?? null);
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
        return this.finishReceipt(
          invoice,
          amount,
          method,
          paymentChannelId,
          receivedAt,
          actor,
        );
      }
      invoice = await this.loadInvoice(invoiceId);
      return this.finishReceipt(
        invoice,
        amount,
        method,
        paymentChannelId,
        receivedAt,
        actor,
      );
    }

    if (invoice.status === 'COLLECTED') {
      // Crash-recovery re-entry: the transition committed but the receipt
      // write did not. Resume it without re-transitioning.
      this.logger.warn(
        `Invoice ${invoiceId}: resuming a partially-completed receipt (status COLLECTED, no receipt row).`,
      );
      return this.finishReceipt(
        invoice,
        amount,
        method,
        paymentChannelId,
        receivedAt,
        actor,
      );
    }

    throw new UnprocessableEntityException(
      `Invoice ${invoiceId} is ${invoice.status}; a collection receipt is recorded while it is INVOICED.`,
    );
  }

  private async finishReceipt(
    invoice: InvoiceWithCycle,
    amount: Prisma.Decimal,
    method: string | null,
    paymentChannelId: string | null,
    receivedAt: Date,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    if (invoice.receipts[0]) {
      // Another concurrent caller wrote the receipt between our transition and
      // here — byte-identical is fine, anything else is a 409.
      const existing = invoice.receipts[0];
      const same =
        compareMoney(existing.amount, amount) === 0 &&
        (existing.method ?? null) === method &&
        (existing.paymentChannelId ?? null) === paymentChannelId;
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
        paymentChannelId,
        receivedAt,
        ledgerReference: `invoice:${invoice.id}`,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // `Receipt.invoiceId @unique` fired — a concurrent caller's receipt
        // committed between our `receipts[0]` read above and this write (it
        // lost the transition race but still reached here before we did). A
        // byte-identical race is an idempotent resume; a genuinely different
        // amount / method / channel is a 409. This is the "the write re-asserts
        // the condition" half of race-safe-invariants.md.
        const now = await this.loadInvoice(invoice.id);
        const landed = now.receipts[0];
        if (
          landed &&
          compareMoney(landed.amount, amount) === 0 &&
          (landed.method ?? null) === method &&
          (landed.paymentChannelId ?? null) === paymentChannelId
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
        paymentChannelId: created.receipt.paymentChannelId,
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

    // Load-only (404 on an unknown id) — after the "no collection" 422 so an
    // unknown channel on a not-yet-collected invoice gets the more useful
    // message; the usability checks come after the write-once resume.
    const channel = await this.loadChannel(dto.paymentChannelId);
    const paymentChannelId = channel?.id ?? null;

    if (receipt.remittance) {
      // Amount + insurer are derived; the channel is a caller input. A re-post
      // with the same channel (or none) is an idempotent no-op; a different
      // stored figure / insurer / channel is a 409, not a silent resume.
      const same =
        compareMoney(receipt.remittance.amount, amount) === 0 &&
        receipt.remittance.insurerId === insurerId &&
        (receipt.remittance.paymentChannelId ?? null) === paymentChannelId;
      if (!same) {
        throw new ConflictException(
          `Invoice ${invoiceId} already has a remittance recorded with different figures.`,
        );
      }
      return deriveInvoiceView(invoice);
    }

    // A NEW remittance — the supplied channel must be usable now.
    if (channel) {
      this.assertRemittanceChannelUsable(channel, insurerId, invoice.currency);
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
          paymentChannelId,
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
        paymentChannelId,
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
        paymentChannelId,
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
    paymentChannelId: string | null,
    remittedAt: Date,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    const landed = invoice.receipts[0]?.remittance;
    if (landed) {
      // A concurrent caller wrote the remittance between our transition and
      // here. Byte-identical (amount + insurer + channel) is an idempotent
      // resume; anything else is a 409 — mirroring `finishReceipt` (the
      // channel is a caller input, so this is no longer an unconditional
      // "deterministic resume").
      const same =
        compareMoney(landed.amount, amount) === 0 &&
        landed.insurerId === insurerId &&
        (landed.paymentChannelId ?? null) === paymentChannelId;
      if (!same) {
        throw new ConflictException(
          `Invoice ${invoice.id} already has a remittance (created concurrently with different figures).`,
        );
      }
      return deriveInvoiceView(invoice);
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
        paymentChannelId,
        remittedAt,
        ledgerReference: `invoice:${invoice.id}`,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // `Remittance.receiptId @unique` fired — a concurrent caller's
        // remittance committed first. Amount + insurer are deterministic; the
        // channel is a caller input, so resume only when it also matches.
        const now = await this.loadInvoice(invoice.id);
        const landed = now.receipts[0]?.remittance;
        if (
          landed &&
          compareMoney(landed.amount, amount) === 0 &&
          landed.insurerId === insurerId &&
          (landed.paymentChannelId ?? null) === paymentChannelId
        ) {
          return deriveInvoiceView(now);
        }
        throw new ConflictException(
          `Invoice ${invoice.id} already has a remittance with different figures (created concurrently).`,
        );
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
        paymentChannelId: created.remittance.paymentChannelId,
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
