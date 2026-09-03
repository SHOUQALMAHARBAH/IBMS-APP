import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { CommissionLedgerEntry } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { CommissionRepository } from '../../repositories/commission.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { assertDifferentActors } from '../../common/maker-checker.util';
import {
  compareMoney,
  formatMoney,
  isZeroMoney,
  quantizeMoney,
} from '../../common/money.util';
import {
  COMMISSION_MAX_RATE_PERCENT,
  commissionEntryAuditSnapshot,
  computeCommissionAmount,
  computeCommissionVat,
  computeReversalState,
  deriveLedgerEntryView,
  isCommissionEntryTransition,
  overrideAuditSnapshot,
  overrideProposalMatches,
  reversalAuditSnapshot,
  resolveGovernedRate,
  settlementAuditSnapshot,
  type CommissionEntryStatus,
  type CommissionLedgerEntryView,
} from './commission.config';
import type { CalculateCommissionDto } from './dto/calculate-commission.dto';
import type { ListCommissionEntriesQueryDto } from './dto/list-commission-entries-query.dto';
import type { RaiseCommissionOverrideDto } from './dto/raise-commission-override.dto';
import type { SettleCommissionDto } from './dto/settle-commission.dto';

/** Cap on a book-wide commission-ledger read (the #30 / #33 precedent). */
export const COMMISSION_LEDGER_READ_LIMIT = 5000;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 35 — the commission ledger (`CommissionLedgerEntry`).
 *
 * `calculate` records the one new-business commission entry per policy at the
 * **governed** rate (`CommissionAgreement` for the policy's insurer + line, in
 * force at inception) — single-actor Finance work (`commission.calculate`), no
 * maker/checker, write-once (`policyId @unique`).
 *
 * A **manual override** (`raiseOverride` → `approveOverride`) IS a maker/checker
 * pair: the raiser (`commission-override.raise` / Finance) proposes an amount +
 * a mandatory reason; a distinct `commission-override.approve` holder (Manager)
 * approves it. `assertDifferentActors` + the `CommissionLedgerEntry_maker_
 * checker_distinct` CHECK are the two backstops. A pending override leaves
 * `amount` (the governed figure) untouched; approval copies `overrideAmount`
 * into `amount`.
 */
@Injectable()
export class CommissionLedgerService {
  private readonly logger = new Logger(CommissionLedgerService.name);

  constructor(
    private readonly commission: CommissionRepository,
    private readonly policies: PolicyRepository,
    private readonly audit: AuditService,
  ) {}

  // --- 1. calculate (governed) ------------------------------------------

  async calculate(
    dto: CalculateCommissionDto,
    actorId: string,
  ): Promise<CommissionLedgerEntryView> {
    const policy = await this.policies.findById(dto.policyId);
    if (!policy) {
      throw new NotFoundException(`Policy ${dto.policyId} not found.`);
    }

    // Write-once resume runs ahead of every input-bound check (the #31
    // recordSettlement / #33 due-date ordering) — an already-recorded entry
    // resolves even if the policy or the rate table has since drifted.
    const existing = await this.commission.findLedgerEntryByPolicyId(
      dto.policyId,
    );
    if (existing?.isManualOverride) return deriveLedgerEntryView(existing);

    if (policy.issuedPremium == null) {
      if (existing) return deriveLedgerEntryView(existing);
      throw new UnprocessableEntityException(
        `Policy ${dto.policyId} has no issued premium yet — issue the policy (Process 19) before calculating commission.`,
      );
    }

    // Resolve the governed rate in force when the business was written.
    const at = policy.inceptionDate ?? policy.createdAt;
    const agreements = await this.commission.findAgreementsForPair(
      policy.insurerId,
      policy.insuranceLine,
    );
    const governed = resolveGovernedRate(agreements, at);
    if (!governed) {
      // Write-once resume BEFORE the "no agreement" 422: a policy whose entry
      // was already recorded must keep resolving even if the agreement was
      // later closed (the #31 recordSettlement / due-date ordering).
      if (existing) return deriveLedgerEntryView(existing);
      throw new UnprocessableEntityException(
        `No commission agreement in force for insurer ${policy.insurerId} / line "${policy.insuranceLine}" at ${at
          .toISOString()
          .slice(0, 10)} — create one first (Process 35 rate table).`,
      );
    }

    const rate = governed.ratePercent;
    if (rate.lessThan(0) || rate.greaterThan(COMMISSION_MAX_RATE_PERCENT)) {
      throw new UnprocessableEntityException(
        `The governed commission rate (${rate.toFixed(2)}%) is outside 0..${COMMISSION_MAX_RATE_PERCENT} — the entry cannot be composed.`,
      );
    }
    const amount = computeCommissionAmount(policy.issuedPremium, rate);
    if (compareMoney(amount, policy.issuedPremium) > 0) {
      throw new UnprocessableEntityException(
        `The commission (${formatMoney(amount)}) would exceed the premium (${formatMoney(
          policy.issuedPremium,
        )}) — check the rate.`,
      );
    }
    // Process 36 — snapshot the governed VAT rate onto the entry and stamp the
    // VAT it implies, so `vatAmount == amount × vatRatePercent%` holds from the
    // first write (a later manual override recomputes it against this frozen
    // rate).
    const vatRatePercent = governed.vatRatePercent;
    const vatAmount = computeCommissionVat(amount, vatRatePercent);

    if (existing) {
      // Compare the FIGURE only — the brain contract is "a matching governed
      // figure resumes; a different one is a 409". Superseding a window with
      // the same numeric rate (a new `CommissionAgreement` row, identical
      // `ratePercent`) must not 409 a harmless recalc just because the
      // agreement id changed.
      if (compareMoney(existing.amount, amount) === 0) {
        return deriveLedgerEntryView(existing);
      }
      throw new ConflictException(
        `Policy ${dto.policyId} already has a commission entry (${formatMoney(
          existing.amount,
        )}); commission is recorded once — a correction is a manual override.`,
      );
    }

    let created: CommissionLedgerEntry;
    try {
      created = await this.commission.createLedgerEntry({
        policyId: dto.policyId,
        commissionAgreementId: governed.id,
        amount,
        vatRatePercent,
        vatAmount,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent calculate won the `policyId @unique` race.
        const now = await this.commission.findLedgerEntryByPolicyId(
          dto.policyId,
        );
        if (
          now &&
          (now.isManualOverride || compareMoney(now.amount, amount) === 0)
        ) {
          return deriveLedgerEntryView(now);
        }
        throw new ConflictException(
          `Policy ${dto.policyId} already has a commission entry (created concurrently with different figures).`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorId,
      action: 'CREATE',
      entityType: 'CommissionLedgerEntry',
      entityId: created.id,
      afterValue: commissionEntryAuditSnapshot({
        entryId: created.id,
        policyId: created.policyId,
        commissionAgreementId: created.commissionAgreementId,
        ratePercentApplied: rate.toFixed(2),
        vatRatePercentApplied: vatRatePercent.toFixed(2),
        amount: created.amount,
        vatAmount: created.vatAmount,
        status: created.status,
      }),
    });

    return deriveLedgerEntryView(created);
  }

  // --- 2. raise a manual override ------------------------------------

  async raiseOverride(
    entryId: string,
    dto: RaiseCommissionOverrideDto,
    actorId: string,
  ): Promise<CommissionLedgerEntryView> {
    const entry = await this.loadEntry(entryId);
    if (entry.status !== 'outstanding') {
      throw new UnprocessableEntityException(
        `Commission entry ${entryId} is ${entry.status}; only an outstanding entry can be overridden.`,
      );
    }

    const overrideAmount = quantizeMoney(dto.overrideAmount);
    const reason = dto.reason.trim();
    if (overrideAmount.lessThan(0)) {
      throw new UnprocessableEntityException(
        'overrideAmount cannot be negative.',
      );
    }
    const policy = await this.policies.findById(entry.policyId);
    if (!policy || policy.issuedPremium == null) {
      // A commission entry cannot exist without an issued-premium policy —
      // treat the impossible state as not-found rather than silently dropping
      // the `overrideAmount <= premium` bound.
      throw new NotFoundException(
        `Commission entry ${entryId}: its policy is missing or not issued.`,
      );
    }
    if (compareMoney(overrideAmount, policy.issuedPremium) > 0) {
      throw new UnprocessableEntityException(
        `overrideAmount (${formatMoney(overrideAmount)}) exceeds the premium (${formatMoney(
          policy.issuedPremium,
        )}).`,
      );
    }

    if (entry.isManualOverride && entry.overrideApprovedByUserId !== null) {
      // An approved override is write-once — byte-identical is an idempotent
      // resume, anything else is a 409.
      if (overrideProposalMatches(entry, { overrideAmount, reason })) {
        return deriveLedgerEntryView(entry);
      }
      throw new ConflictException(
        `Commission entry ${entryId} already has an approved override; a further change needs a new correction path.`,
      );
    }

    // No override, or a still-pending one (Finance may revise freely until a
    // Manager approves).
    const res = await this.commission.recordOverrideRaise(entryId, {
      overrideAmount,
      overrideReason: reason,
      overrideRequestedByUserId: actorId,
    });
    if (res.count === 0) {
      // status flipped out from under us (paid/reversed) or got approved
      // concurrently.
      throw new ConflictException(
        `Commission entry ${entryId} could not accept the override — reload and retry.`,
      );
    }

    const after = await this.loadEntry(entryId);
    await this.safeAudit({
      userId: actorId,
      action: 'UPDATE',
      entityType: 'CommissionLedgerEntry',
      entityId: entryId,
      afterValue: overrideAuditSnapshot({
        entryId,
        policyId: entry.policyId,
        overrideAmount,
        overrideReason: reason,
        overrideRequestedByUserId: actorId,
        overrideApprovedByUserId: null,
        amountAfter: after.amount,
      }),
    });

    return deriveLedgerEntryView(after);
  }

  // --- 3. approve the override (maker/checker) -----------------------

  async approveOverride(
    entryId: string,
    actorId: string,
  ): Promise<CommissionLedgerEntryView> {
    const entry = await this.loadEntry(entryId);
    if (!entry.isManualOverride || entry.overrideAmount === null) {
      throw new UnprocessableEntityException(
        `Commission entry ${entryId} has no override pending.`,
      );
    }
    if (entry.overrideApprovedByUserId !== null) {
      if (entry.overrideApprovedByUserId === actorId) {
        return deriveLedgerEntryView(entry); // idempotent
      }
      throw new ConflictException(
        `Commission entry ${entryId}'s override was already approved by a different user.`,
      );
    }
    if (entry.overrideRequestedByUserId === null) {
      // A pending override always carries its requester; a null one is
      // malformed and must not slip past the maker/checker guard on a `''`
      // coalesce (the #28 fix).
      throw new ConflictException(
        `Commission entry ${entryId}'s override has no recorded requester — it cannot be approved.`,
      );
    }
    assertDifferentActors(
      entry.overrideRequestedByUserId,
      actorId,
      'CommissionLedgerEntry.approveOverride',
    );

    // The `where` re-asserts the exact requester `assertDifferentActors` was
    // checked against and the exact amount being copied in, so a concurrent
    // `raiseOverride` (which could change either) turns this into a clean
    // 0-row → 409 rather than a DB-CHECK 500 or a stale-amount write. `vatAmount`
    // is recomputed from `overrideAmount × the entry's frozen vatRatePercent`
    // so the `vatAmount == amount × vatRatePercent%` invariant survives the
    // override (Process 36).
    const res = await this.commission.recordOverrideApproval(entryId, actorId, {
      requestedByUserId: entry.overrideRequestedByUserId,
      overrideAmount: entry.overrideAmount,
      vatAmount: computeCommissionVat(
        entry.overrideAmount,
        entry.vatRatePercent,
      ),
    });
    if (res.count === 0) {
      const now = await this.loadEntry(entryId);
      if (now.overrideApprovedByUserId === actorId) {
        return deriveLedgerEntryView(now);
      }
      throw new ConflictException(
        `Commission entry ${entryId}'s override changed or was approved concurrently — reload and retry.`,
      );
    }

    const after = await this.loadEntry(entryId);
    await this.safeAudit({
      userId: actorId,
      action: 'APPROVE',
      entityType: 'CommissionLedgerEntry',
      entityId: entryId,
      afterValue: overrideAuditSnapshot({
        entryId,
        policyId: after.policyId,
        overrideAmount: entry.overrideAmount,
        overrideReason: after.overrideReason ?? '',
        overrideRequestedByUserId: entry.overrideRequestedByUserId,
        overrideApprovedByUserId: actorId,
        amountAfter: after.amount,
      }),
    });

    return deriveLedgerEntryView(after);
  }

  // --- 4. settle (Process 36 — reconcile against an insurer statement) ---

  /**
   * `outstanding -> paid`: reconcile the entry against an insurer commission
   * statement and mark it settled. Single-actor Finance (`commission.reconcile`)
   * — moving the governed figure to `paid` is mechanical, not an approval (the
   * maker/checker in commission is the manual override).
   *
   * `statementAmount` MUST equal the governed `amount` exactly
   * (`money-decimal-jod.md`: "a reconciliation mismatch is raised as an
   * exception, never silently written off" — a variance is a Process 39
   * `ReconciliationException`, not a short settle here). A still-pending
   * override blocks settlement (the amount is not final). A `reversed` entry
   * cannot be settled. Deterministic → a re-`POST` with the same statement
   * figure + reference resumes (200); a different one is a 409.
   */
  async settle(
    entryId: string,
    dto: SettleCommissionDto,
    actorId: string,
  ): Promise<CommissionLedgerEntryView> {
    const entry = await this.loadEntry(entryId);
    const statementAmount = quantizeMoney(dto.statementAmount);
    const paymentReference = dto.paymentReference.trim();

    if (entry.status === 'paid') {
      // Write-once resume vs. 409 — the figure AND the reference must match.
      if (
        entry.paidAmount !== null &&
        compareMoney(entry.paidAmount, statementAmount) === 0 &&
        entry.paymentReference === paymentReference
      ) {
        return deriveLedgerEntryView(entry);
      }
      throw new ConflictException(
        `Commission entry ${entryId} is already reconciled (${formatMoney(
          entry.paidAmount ?? entry.amount,
        )}, ref "${entry.paymentReference ?? ''}").`,
      );
    }
    if (entry.status === 'reversed') {
      throw new UnprocessableEntityException(
        `Commission entry ${entryId} was reversed; a reversed entry cannot be reconciled.`,
      );
    }
    if (entry.isManualOverride && entry.overrideApprovedByUserId === null) {
      throw new UnprocessableEntityException(
        `Commission entry ${entryId} has a pending manual override — approve or resolve it before reconciling.`,
      );
    }
    // The status move is `outstanding -> paid`; assert it against the lifecycle
    // map (the one place the caller-side legal-move check lives — the `where`
    // below and the guards above are the enforcement, this is the contract).
    this.assertEntryTransition(entry.status, 'paid');
    // Re-check the reversal gate from LIVE Process 22 rows (the #16 rule): a
    // CommissionReversal on the policy whose best-effort flip has not landed
    // must still block a settle rather than pay commission on cancelled cover.
    const reversalAmounts =
      await this.commission.findCommissionReversalAmountsForPolicy(
        entry.policyId,
      );
    const { reversedAmount } = computeReversalState({
      entryAmount: entry.amount,
      reversalAmounts,
    });
    if (!isZeroMoney(reversedAmount)) {
      throw new UnprocessableEntityException(
        `Commission entry ${entryId} has a commission reversal from a Process 22 endorsement (${formatMoney(
          reversedAmount,
        )}); it cannot be reconciled — resolve the reversal first.`,
      );
    }

    if (compareMoney(statementAmount, entry.amount) !== 0) {
      const variance = statementAmount.minus(entry.amount);
      throw new UnprocessableEntityException(
        `Statement amount ${formatMoney(statementAmount)} does not match the recorded commission ${formatMoney(
          entry.amount,
        )} (variance ${formatMoney(variance)}); raise a reconciliation exception (Process 39) — a mismatch is never written off here.`,
      );
    }

    const res = await this.commission.recordEntrySettlement(entryId, {
      expectedAmount: entry.amount,
      // == entry.amount (asserted equal above); use the validated statement
      // figure so `paidAmount` reads as "what the insurer's statement paid".
      paidAmount: statementAmount,
      paymentReference,
    });
    if (res.count === 0) {
      const now = await this.loadEntry(entryId);
      if (
        now.status === 'paid' &&
        now.paidAmount !== null &&
        compareMoney(now.paidAmount, statementAmount) === 0 &&
        now.paymentReference === paymentReference
      ) {
        return deriveLedgerEntryView(now);
      }
      throw new ConflictException(
        `Commission entry ${entryId} changed before it could be reconciled — reload and retry.`,
      );
    }

    const after = await this.loadEntry(entryId);
    await this.safeAudit({
      userId: actorId,
      action: 'UPDATE',
      entityType: 'CommissionLedgerEntry',
      entityId: entryId,
      afterValue: settlementAuditSnapshot({
        entryId,
        policyId: after.policyId,
        paidAmount: after.paidAmount ?? after.amount,
        paymentReference,
        status: after.status,
      }),
    });

    return deriveLedgerEntryView(after);
  }

  // --- 5. reconcile a Process 22 reversal onto the ledger entry --------

  /**
   * Reflect any Process 22 `CommissionReversal` on the policy onto its
   * `CommissionLedgerEntry`: accumulate `reversedAmount` and flip
   * `status -> reversed` once the full earned commission is clawed back.
   * Called **best-effort** by the endorsement service after it mints a
   * `CommissionReversal` (the #29 `lossRatio.recomputeForPolicy` precedent —
   * only the actual transitioner, never blocking the endorsement flow); it
   * recomputes from live rows so a missed call self-heals on the next
   * invocation, and `settle` re-checks the same gate independently.
   */
  async reconcileReversalForPolicy(
    policyId: string,
    actorId: string,
  ): Promise<void> {
    const entry = await this.commission.findLedgerEntryByPolicyId(policyId);
    if (!entry || entry.status === 'reversed') return;

    const reversalAmounts =
      await this.commission.findCommissionReversalAmountsForPolicy(policyId);
    const { reversedAmount, fullyReversed } = computeReversalState({
      entryAmount: entry.amount,
      reversalAmounts,
    });
    if (isZeroMoney(reversedAmount)) return; // no reversal recorded yet
    if (
      entry.reversedAmount !== null &&
      compareMoney(entry.reversedAmount, reversedAmount) === 0 &&
      !fullyReversed
    ) {
      return; // already reflected, nothing changed
    }

    // `entry.status` is `outstanding` | `paid` here (we returned on `reversed`);
    // both are legal predecessors of `reversed`. Assert it when this call makes
    // the status terminal, so the lifecycle map governs the flip.
    if (fullyReversed) {
      this.assertEntryTransition(entry.status, 'reversed');
    }

    const reversalReason =
      entry.reversalReason ??
      `Commission reversed by a Process 22 negative / cancellation endorsement on the policy.`;
    const res = await this.commission.recordEntryReversal(entry.id, {
      reversedAmount,
      // Stamped once, at the FIRST reflection — "when the clawback started",
      // not a last-updated timestamp; later accumulations keep it.
      reversedAt: entry.reversedAt ?? new Date(),
      reversalReason,
      toReversed: fullyReversed,
    });
    if (res.count === 0) return;

    const after = await this.loadEntry(entry.id);
    await this.safeAudit({
      userId: actorId,
      action: 'UPDATE',
      entityType: 'CommissionLedgerEntry',
      entityId: entry.id,
      afterValue: reversalAuditSnapshot({
        entryId: entry.id,
        policyId,
        reversedAmount: after.reversedAmount ?? reversedAmount,
        reversalReason: after.reversalReason ?? reversalReason,
        status: after.status,
      }),
    });
  }

  // --- reads ----------------------------------------------------------

  async get(id: string): Promise<CommissionLedgerEntryView> {
    return deriveLedgerEntryView(await this.loadEntry(id));
  }

  async list(
    query: ListCommissionEntriesQueryDto,
  ): Promise<CommissionLedgerEntryView[]> {
    const rows = await this.commission.findLedgerEntries(
      { policyId: query.policyId, insurerId: query.insurerId },
      COMMISSION_LEDGER_READ_LIMIT,
    );
    if (rows.length >= COMMISSION_LEDGER_READ_LIMIT) {
      this.logger.warn(
        `Commission ledger read truncated at ${COMMISSION_LEDGER_READ_LIMIT} rows — narrow with policyId / insurerId.`,
      );
    }
    return rows.map(deriveLedgerEntryView);
  }

  private async loadEntry(id: string) {
    const entry = await this.commission.findLedgerEntryById(id);
    if (!entry) {
      throw new NotFoundException(`Commission entry ${id} not found.`);
    }
    return entry;
  }

  /** Assert `from -> to` is a legal `CommissionLedgerEntry.status` move
   * (`COMMISSION_ENTRY_TRANSITIONS`). `CommissionLedgerEntry` is not a
   * `WorkflowTransitionService` entity, so this — plus the status-conditional
   * `updateMany` `where` in the repository — is how every move is validated. */
  private assertEntryTransition(from: string, to: CommissionEntryStatus): void {
    if (!isCommissionEntryTransition(from, to)) {
      throw new ConflictException(
        `Commission entry cannot move ${from} -> ${to}.`,
      );
    }
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Commission-ledger audit (${input.action} ${input.entityType} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
