import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { ReconciliationException } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import {
  ReconciliationRepository,
  RECON_EXCEPTION_READ_LIMIT,
} from '../../repositories/reconciliation.repository';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import {
  compareMoney,
  isZeroMoney,
  quantizeMoney,
} from '../../common/money.util';
import {
  computeRemittanceAmount,
  computeVariance,
  deriveReconExceptionView,
  isReconExceptionTransition,
  reconExceptionAuditSnapshot,
  reconExceptionUpdateAuditSnapshot,
  RECON_DETECT_MAX_LINES,
  RECON_INVOICE_RESUME_STATUSES,
  type ReconExceptionStatus,
  type ReconExceptionView,
  type ReconInvoiceResumeStatus,
} from './finance.config';
import type { DetectReconciliationDto } from './dto/detect-reconciliation.dto';
import type { ResolveReconciliationDto } from './dto/resolve-reconciliation.dto';
import type { ListReconciliationExceptionsQueryDto } from './dto/list-reconciliation-exceptions-query.dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** Invoice statuses from which the engine map allows `-> EXCEPTION_RAISED`. */
const EXCEPTION_RAISABLE_FROM = ['COLLECTED', 'RECONCILED'] as const;

type LineOutcome =
  | 'reconciled'
  | 'exception_raised'
  | 'exception_exists'
  | 'conflicting_exception'
  | 'invoice_not_found'
  | 'not_a_policy_invoice';

interface DetectLineResult {
  invoiceId: string;
  outcome: LineOutcome;
  varianceAmount?: string;
  exceptionId?: string;
  invoiceStatus?: string;
}

export interface DetectReconciliationResult {
  lineCount: number;
  reconciled: number;
  exceptionsRaised: number;
  results: DetectLineResult[];
}

/**
 * Process 39 — Bank Reconciliation (backlog Part C #39, Domain D). Runs the
 * insurer-statement-vs-broker-record variance check and manages the resulting
 * `ReconciliationException` rows through their investigate / resolve path.
 *
 *   - `detect` compares each statement line's `insurerStatementAmount` against
 *     the broker's record (`premiumAmount − commissionDeducted`) and raises a
 *     `ReconciliationException` for every non-zero variance (never silently
 *     written off — `money-decimal-jod.md`), driving the parent `Invoice`
 *     `COLLECTED|RECONCILED → EXCEPTION_RAISED` through the workflow engine
 *     when its state allows.
 *   - `investigate` claims an `open` exception (`→ investigating`).
 *   - `resolve` closes it with a mandatory `resolutionNote` (`→ resolved`) and,
 *     when the parent `Invoice` is `EXCEPTION_RAISED` / `EXCEPTION_RESOLVED`,
 *     drives it `→ EXCEPTION_RESOLVED → RECONCILED` (`resumeInvoiceAs`, which
 *     can only be `RECONCILED` — a straight `→ REMITTED` would skip the
 *     `Remittance` + client-funds ledger entry). NO figure is adjusted.
 *
 * `ReconciliationException.status` is a plain string (the `CommissionLedger
 * Entry.status` pattern) — every move validates against
 * `RECON_EXCEPTION_TRANSITIONS` and persists via a status-conditional
 * `updateMany`. No maker/checker (`roles-and-segregation-of-duties.md` — the
 * Finance maker/checker pair is refunds / overrides; reconciling the cycle is
 * single-actor). Book-wide.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly exceptions: ReconciliationRepository,
    private readonly invoices: InvoiceRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. detect (raise an exception per non-zero variance) ------------

  async detect(
    dto: DetectReconciliationDto,
    actorId: string,
  ): Promise<DetectReconciliationResult> {
    if (dto.lines.length > RECON_DETECT_MAX_LINES) {
      throw new UnprocessableEntityException(
        `A statement batch cannot exceed ${RECON_DETECT_MAX_LINES} lines.`,
      );
    }
    const seen = new Set<string>();
    for (const line of dto.lines) {
      if (seen.has(line.invoiceId)) {
        throw new UnprocessableEntityException(
          `Duplicate statement line for invoice ${line.invoiceId}.`,
        );
      }
      seen.add(line.invoiceId);
    }

    const results: DetectLineResult[] = [];
    for (const line of dto.lines) {
      results.push(await this.detectOne(line, actorId));
    }

    return {
      lineCount: results.length,
      reconciled: results.filter((r) => r.outcome === 'reconciled').length,
      exceptionsRaised: results.filter((r) => r.outcome === 'exception_raised')
        .length,
      results,
    };
  }

  private async detectOne(
    line: { invoiceId: string; insurerStatementAmount: string },
    actorId: string,
  ): Promise<DetectLineResult> {
    const invoice = await this.invoices.findById(line.invoiceId);
    if (!invoice) {
      return { invoiceId: line.invoiceId, outcome: 'invoice_not_found' };
    }
    if (invoice.policyId == null) {
      return {
        invoiceId: line.invoiceId,
        outcome: 'not_a_policy_invoice',
        invoiceStatus: invoice.status,
      };
    }

    const statementAmount = quantizeMoney(line.insurerStatementAmount);
    const brokerRecordAmount = computeRemittanceAmount(
      invoice.premiumAmount,
      invoice.commissionDeducted,
    );
    const varianceAmount = computeVariance(statementAmount, brokerRecordAmount);
    // Always report THIS run's freshly computed variance (fils-exact), even on
    // a conflict — an operator re-running detect with a corrected statement
    // must see what the new figure is without first resolving the old row.
    const freshVariance = this.viewAmount(varianceAmount);

    if (isZeroMoney(varianceAmount)) {
      return {
        invoiceId: line.invoiceId,
        outcome: 'reconciled',
        varianceAmount: '0.000',
        invoiceStatus: invoice.status,
      };
    }

    // Non-zero variance — an exception is MANDATORY (never silently written
    // off). One non-resolved exception per invoice (partial UNIQUE backstop).
    const sameFigures = (open: ReconciliationException): boolean =>
      compareMoney(open.insurerStatementAmount, statementAmount) === 0 &&
      compareMoney(open.brokerRecordAmount, brokerRecordAmount) === 0;

    const open = await this.exceptions.findOpenExceptionForInvoice(
      line.invoiceId,
    );
    if (open) {
      const same = sameFigures(open);
      if (same) {
        // Self-heal: a prior detect that raised this exception may have failed
        // its best-effort `-> EXCEPTION_RAISED` hop, leaving the invoice in
        // COLLECTED / RECONCILED with an open exception. Re-assert it here.
        await this.raiseInvoiceExceptionBestEffort(
          invoice.status,
          line.invoiceId,
          open.id,
          actorId,
        );
      }
      return {
        invoiceId: line.invoiceId,
        outcome: same ? 'exception_exists' : 'conflicting_exception',
        exceptionId: open.id,
        varianceAmount: freshVariance,
        invoiceStatus: invoice.status,
      };
    }

    let created: ReconciliationException;
    try {
      created = await this.exceptions.createException({
        invoiceId: line.invoiceId,
        insurerStatementAmount: statementAmount,
        brokerRecordAmount,
        varianceAmount,
        raisedByUserId: actorId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const now = await this.exceptions.findOpenExceptionForInvoice(
          line.invoiceId,
        );
        if (now && sameFigures(now)) {
          await this.raiseInvoiceExceptionBestEffort(
            invoice.status,
            line.invoiceId,
            now.id,
            actorId,
          );
          return {
            invoiceId: line.invoiceId,
            outcome: 'exception_exists',
            exceptionId: now.id,
            varianceAmount: freshVariance,
            invoiceStatus: invoice.status,
          };
        }
        return {
          invoiceId: line.invoiceId,
          outcome: 'conflicting_exception',
          exceptionId: now?.id,
          varianceAmount: freshVariance,
          invoiceStatus: invoice.status,
        };
      }
      throw err;
    }

    // Best-effort audit — the variance is now recorded, that is the guarantee.
    await this.safeAudit({
      userId: actorId,
      action: 'CREATE',
      entityType: 'ReconciliationException',
      entityId: created.id,
      afterValue: reconExceptionAuditSnapshot({
        exceptionId: created.id,
        invoiceId: created.invoiceId,
        insurerStatementAmount: created.insurerStatementAmount,
        brokerRecordAmount: created.brokerRecordAmount,
        varianceAmount: created.varianceAmount,
        status: created.status,
      }),
    });

    await this.raiseInvoiceExceptionBestEffort(
      invoice.status,
      line.invoiceId,
      created.id,
      actorId,
    );

    return {
      invoiceId: line.invoiceId,
      outcome: 'exception_raised',
      exceptionId: created.id,
      varianceAmount: this.viewAmount(created.varianceAmount),
      invoiceStatus: invoice.status,
    };
  }

  /** Drive the parent `Invoice` `COLLECTED | RECONCILED -> EXCEPTION_RAISED`
   * when its state allows. The exception is already recorded — this hop is
   * best-effort (a failure is logged, never thrown, per the Process 39 design),
   * and it is idempotent-friendly: a re-run for an invoice already at
   * `EXCEPTION_RAISED` is a no-op here (state not in `EXCEPTION_RAISABLE_FROM`). */
  private async raiseInvoiceExceptionBestEffort(
    invoiceStatus: string,
    invoiceId: string,
    exceptionId: string,
    actorId: string,
  ): Promise<void> {
    if (
      !(EXCEPTION_RAISABLE_FROM as readonly string[]).includes(invoiceStatus)
    ) {
      return;
    }
    try {
      await this.workflow.transition({
        entityType: 'Invoice',
        entityId: invoiceId,
        toStatus: 'EXCEPTION_RAISED',
        actorUserId: actorId,
      });
    } catch (err) {
      this.logger.error(
        `ReconciliationException ${exceptionId}: invoice ${invoiceId} could not move to EXCEPTION_RAISED (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  // --- 2. investigate (open -> investigating) -------------------------

  async investigate(id: string, actorId: string): Promise<ReconExceptionView> {
    const ex = await this.loadException(id);
    if (ex.status === 'investigating') return deriveReconExceptionView(ex); // claim, idempotent
    if (ex.status === 'resolved') {
      throw new UnprocessableEntityException(
        `Reconciliation exception ${id} is already resolved.`,
      );
    }
    this.assertTransition(ex.status, 'investigating');

    const res = await this.exceptions.recordInvestigation(id, actorId);
    if (res.count === 0) {
      const now = await this.loadException(id);
      if (now.status === 'investigating' || now.status === 'resolved') {
        return deriveReconExceptionView(now);
      }
      throw new ConflictException(
        `Reconciliation exception ${id} changed concurrently — reload and retry.`,
      );
    }

    const after = await this.loadException(id);
    await this.safeAudit({
      userId: actorId,
      action: 'UPDATE',
      entityType: 'ReconciliationException',
      entityId: id,
      afterValue: reconExceptionUpdateAuditSnapshot({
        exceptionId: id,
        invoiceId: after.invoiceId,
        varianceAmount: after.varianceAmount,
        status: after.status,
        investigatedByUserId: after.investigatedByUserId,
        resolvedByUserId: null,
        resolutionNote: null,
        resumeInvoiceAs: null,
      }),
    });
    return deriveReconExceptionView(after);
  }

  // --- 3. resolve ({open|investigating} -> resolved) + resume the invoice

  async resolve(
    id: string,
    dto: ResolveReconciliationDto,
    actorId: string,
  ): Promise<ReconExceptionView> {
    const ex = await this.loadException(id);
    const resolutionNote = dto.resolutionNote.trim();
    const resumeInvoiceAs = dto.resumeInvoiceAs as
      ReconInvoiceResumeStatus | undefined;

    if (ex.status === 'resolved') {
      if (ex.resolutionNote === resolutionNote) {
        return deriveReconExceptionView(ex); // idempotent
      }
      throw new ConflictException(
        `Reconciliation exception ${id} is already resolved with a different note.`,
      );
    }
    this.assertTransition(ex.status, 'resolved');

    // Move the parent Invoice on FIRST (so a crash before the exception write
    // is a clean retry), then close the exception. The invoice may be
    // EXCEPTION_RAISED (two hops) or EXCEPTION_RESOLVED (a prior resolve got
    // half-way) — either resumes at `resumeInvoiceAs`.
    let didResumeInvoice = false;
    if (ex.invoiceId) {
      didResumeInvoice = await this.resumeInvoice(
        ex.invoiceId,
        resumeInvoiceAs,
        actorId,
      );
    }

    const res = await this.exceptions.recordResolution(id, {
      resolutionNote,
      resolvedByUserId: actorId,
    });
    if (res.count === 0) {
      const now = await this.loadException(id);
      if (now.status === 'resolved' && now.resolutionNote === resolutionNote) {
        return deriveReconExceptionView(now);
      }
      throw new ConflictException(
        `Reconciliation exception ${id} changed concurrently — reload and retry.`,
      );
    }

    const after = await this.loadException(id);
    await this.safeAudit({
      userId: actorId,
      action: 'UPDATE',
      entityType: 'ReconciliationException',
      entityId: id,
      afterValue: reconExceptionUpdateAuditSnapshot({
        exceptionId: id,
        invoiceId: after.invoiceId,
        varianceAmount: after.varianceAmount,
        status: after.status,
        investigatedByUserId: after.investigatedByUserId,
        resolvedByUserId: after.resolvedByUserId,
        resolutionNote: after.resolutionNote,
        // Only record the resume target when a hop actually used it — a resolve
        // on an exception whose invoice was not mid-cycle moved nothing.
        resumeInvoiceAs: didResumeInvoice ? (resumeInvoiceAs ?? null) : null,
      }),
    });
    return deriveReconExceptionView(after);
  }

  /** Drive an invoice out of its exception branch back to `resumeInvoiceAs`
   * (`RECONCILED` only — see `RECON_INVOICE_RESUME_STATUSES`).
   * `EXCEPTION_RAISED -> EXCEPTION_RESOLVED -> RECONCILED`; a re-entry that
   * finds it already at `EXCEPTION_RESOLVED` runs only the last hop; any other
   * state is a no-op (the exception was raised on a REMITTED / INVOICED
   * invoice, or another caller already resumed it). Re-reads between the two
   * hops so a concurrent resolve that already carried the invoice past
   * `EXCEPTION_RESOLVED` is a clean no-op, not a same-state engine error.
   * Returns whether a resume hop actually ran. */
  private async resumeInvoice(
    invoiceId: string,
    resumeInvoiceAs: ReconInvoiceResumeStatus | undefined,
    actorId: string,
  ): Promise<boolean> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) return false;
    if (
      invoice.status !== 'EXCEPTION_RAISED' &&
      invoice.status !== 'EXCEPTION_RESOLVED'
    ) {
      return false; // not mid-exception — nothing to resume
    }
    if (!resumeInvoiceAs) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} is ${invoice.status}; resumeInvoiceAs is required (one of ${RECON_INVOICE_RESUME_STATUSES.join(', ')}).`,
      );
    }
    if (invoice.status === 'EXCEPTION_RAISED') {
      await this.workflow.transition({
        entityType: 'Invoice',
        entityId: invoiceId,
        toStatus: 'EXCEPTION_RESOLVED',
        actorUserId: actorId,
      });
    }
    // A concurrent resolve may have moved it on already — only take the last
    // hop if it is still sitting at EXCEPTION_RESOLVED.
    const mid = await this.invoices.findById(invoiceId);
    if (!mid || mid.status !== 'EXCEPTION_RESOLVED') return true;
    await this.workflow.transition({
      entityType: 'Invoice',
      entityId: invoiceId,
      toStatus: resumeInvoiceAs,
      actorUserId: actorId,
    });
    return true;
  }

  // --- reads --------------------------------------------------------

  async get(id: string): Promise<ReconExceptionView> {
    return deriveReconExceptionView(await this.loadException(id));
  }

  async list(
    query: ListReconciliationExceptionsQueryDto,
  ): Promise<ReconExceptionView[]> {
    const rows = await this.exceptions.findExceptions(
      { invoiceId: query.invoiceId, status: query.status },
      RECON_EXCEPTION_READ_LIMIT,
    );
    if (rows.length >= RECON_EXCEPTION_READ_LIMIT) {
      this.logger.warn(
        `Reconciliation-exception read truncated at ${RECON_EXCEPTION_READ_LIMIT} rows — narrow with invoiceId / status.`,
      );
    }
    return rows.map(deriveReconExceptionView);
  }

  // --- helpers -----------------------------------------------------

  private async loadException(id: string): Promise<ReconciliationException> {
    const ex = await this.exceptions.findExceptionById(id);
    if (!ex) {
      throw new NotFoundException(`Reconciliation exception ${id} not found.`);
    }
    return ex;
  }

  private assertTransition(from: string, to: ReconExceptionStatus): void {
    if (!isReconExceptionTransition(from, to)) {
      throw new ConflictException(
        `Reconciliation exception cannot move ${from} -> ${to}.`,
      );
    }
  }

  private viewAmount(v: Prisma.Decimal): string {
    return v.toFixed(3);
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Reconciliation audit (${input.action} ${input.entityType} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
