import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { ClientFundsLedgerEntry, PaymentChannel, Receipt } from '@ibms/db';
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
    const invoice = await this.loadInvoice(invoiceId);
    const amount = quantizeMoney(dto.amount);
    // Load-only (404 on an unknown id) — the usability checks come after the
    // idempotent resume, so a retry after the channel was disabled still resumes.
    const channel = await this.loadChannel(dto.paymentChannelId);
    const paymentChannelId = channel?.id ?? null;
    const method = this.receiptMethodFor(channel, dto.method ?? null);
    const reference = dto.reference ?? null;
    const receivedAt = dto.receivedAt
      ? parseHistoricalInstant(dto.receivedAt, 'receivedAt')
      : new Date();

    // Idempotent retry. With instalments allowed, figures alone can no longer
    // tell a retry from a genuine second payment of the same amount, so the
    // client's payment `reference` is the key (partial UNIQUE per invoice).
    if (reference !== null) {
      const already = invoice.receipts.find((r) => r.reference === reference);
      if (already) {
        const same =
          compareMoney(already.amount, amount) === 0 &&
          (already.method ?? null) === method &&
          (already.paymentChannelId ?? null) === paymentChannelId;
        if (!same) {
          throw new ConflictException(
            `Invoice ${invoiceId} already has a receipt with reference "${reference}" for ${formatMoney(
              already.amount,
            )}. A receipt is recorded once — a correction is not yet supported.`,
          );
        }
        return deriveInvoiceView(invoice);
      }
    }

    if (invoice.status !== 'INVOICED' && invoice.status !== 'COLLECTED') {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} is ${invoice.status}; a collection receipt is recorded while it is INVOICED.`,
      );
    }

    const collectedSoFar = sumMoney(invoice.receipts.map((r) => r.amount));
    if (compareMoney(collectedSoFar, invoice.totalAmount) >= 0) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} is already collected in full (${formatMoney(
          collectedSoFar,
        )} of ${formatMoney(invoice.totalAmount)}). An over payment is a variance — record it through Process 39, not here.`,
      );
    }

    if (compareMoney(amount, '0') <= 0) {
      throw new UnprocessableEntityException(
        `amount (${formatMoney(amount)}) must be greater than zero.`,
      );
    }

    // A NEW receipt — the supplied channel must be usable now.
    if (channel) {
      this.assertReceiptChannelUsable(channel, invoice, dto.method ?? null);
    }

    // The write itself re-derives the running total under a row lock on the
    // parent Invoice and refuses an overshoot there, so this pre-check is a
    // friendly early 422, not the gate (race-safe-invariants.md — the gate is
    // the serialised write).
    let written: Awaited<
      ReturnType<InvoiceRepository['recordReceiptWithLedger']>
    >;
    try {
      written = await this.invoices.recordReceiptWithLedger({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        method,
        reference,
        paymentChannelId,
        receivedAt,
        ledgerReference: `invoice:${invoice.id}`,
      });
    } catch (err) {
      // `Receipt_invoiceId_reference_key` fired — the retry this reference
      // exists to make safe raced itself, and the winner's row committed
      // between our idempotency read above and this write. Resolve it exactly
      // as the read would have: byte-identical is an idempotent resume,
      // anything else is a 409. This is the "the write re-asserts the
      // condition" half of race-safe-invariants.md.
      if (isUniqueViolation(err) && reference !== null) {
        const now = await this.loadInvoice(invoice.id);
        const landed = now.receipts.find((r) => r.reference === reference);
        if (
          landed &&
          compareMoney(landed.amount, amount) === 0 &&
          (landed.method ?? null) === method &&
          (landed.paymentChannelId ?? null) === paymentChannelId
        ) {
          return deriveInvoiceView(now);
        }
        throw new ConflictException(
          `Invoice ${invoice.id} already has a receipt with reference "${reference}" (created concurrently with different figures).`,
        );
      }
      throw err;
    }

    if (written.outcome === 'exceeds_total') {
      throw new UnprocessableEntityException(
        `amount (${formatMoney(amount)}) would take the collected total to more than the invoiced total (${formatMoney(
          written.collectedBefore,
        )} already collected of ${formatMoney(
          written.totalAmount,
        )}). An over payment is a variance — record it through Process 39, not here.`,
      );
    }

    await this.auditReceipt(
      invoice,
      written.receipt,
      written.ledgerEntry,
      actor,
    );

    // Only the instalment that COMPLETES the invoice moves it on. A part
    // payment leaves it INVOICED, which is what keeps it on the #33 ageing
    // report (for its remaining balance) and off the #34 payables report.
    if (written.fullyCollected && invoice.status === 'INVOICED') {
      try {
        await this.workflow.transition({
          entityType: 'Invoice',
          entityId: invoiceId,
          toStatus: 'COLLECTED',
          actorUserId: actor.id,
        });
      } catch (err) {
        // The receipt and its ledger row have committed — they are the
        // authoritative money record. A concurrent final instalment may have
        // already walked the invoice to COLLECTED; either way the status
        // self-heals on the next call (`reconcile` re-derives the sum from
        // live rows regardless). Logged, never thrown.
        this.logger.warn(
          `Invoice ${invoiceId}: receipt ${written.receipt.id} committed but the INVOICED -> COLLECTED transition did not apply: ${(err as Error).message}`,
        );
      }
    }

    return deriveInvoiceView(await this.loadInvoice(invoiceId));
  }

  /** Best-effort audit of a committed instalment: the receipt and its
   * client-funds movement, money as fixed 3dp strings, no free text. */
  private async auditReceipt(
    invoice: InvoiceWithCycle,
    receipt: Receipt,
    ledgerEntry: ClientFundsLedgerEntry,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Receipt',
      entityId: receipt.id,
      afterValue: receiptAuditSnapshot({
        receiptId: receipt.id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: receipt.amount,
        method: receipt.method,
        paymentChannelId: receipt.paymentChannelId,
        receivedAt: receipt.receivedAt,
      }),
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ClientFundsLedgerEntry',
      entityId: ledgerEntry.id,
      afterValue: clientFundsLedgerAuditSnapshot({
        entryId: ledgerEntry.id,
        customerId: ledgerEntry.customerId,
        amount: ledgerEntry.amount,
        direction: ledgerEntry.direction,
        reference: ledgerEntry.reference,
      }),
    });
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

    // The Remittance hangs off ONE receipt (`Remittance.receiptId @unique` is
    // what keeps it to one per invoice). With instalments an invoice can have
    // several, so the anchor is fixed deliberately at the FIRST one
    // (`receipts` arrives ordered `receivedAt asc`) — arbitrary but stable, so
    // a retry always resolves to the same row. Reaching here at all means the
    // invoice is RECONCILED, which `reconcile()` only grants once the
    // instalments sum to the invoiced total.
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
