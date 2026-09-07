import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildInternalControlsReport,
  classifyCrossTableRows,
  classifyPairRows,
  INTERNAL_CONTROLS_SCAN_LIMIT,
  MAKER_CHECKER_REGISTRY,
  POLICY_CHECKING_ISSUER_PAIR,
  type InternalControlsAuditReport,
  type MakerCheckerPair,
  type MakerCheckerPairResult,
  type PolicyCheckingCrossTableRow,
  type ScannedRow,
} from './internal-controls.config';

/** The generated Prisma client's delegates all share this much of a shape —
 * enough to run the registry's uniform `findMany` without a 15-way switch
 * over model names, at the cost of the cast below. `select` intentionally
 * carries no `where`: a checker field's nullability differs per model
 * (`AccessRecertificationItem.reviewerUserId` is NOT NULL, every other
 * checker field is nullable), so filtering happens in `classifyPairRows`
 * instead of trusting every model's generated filter type to accept
 * `{ not: null }` the same way. */
interface GenericFindManyDelegate {
  findMany(args: {
    select: Record<string, unknown>;
    take: number;
  }): Promise<ScannedRow[]>;
}

/**
 * Process 56 (backlog Part C #56, Domain F) — Internal Controls (Maker/
 * Checker). "Fully covered in Part A.5" (the `assertDifferentActors` guard +
 * a DB `CHECK` on every pair — see `common/maker-checker.util.ts`) — this
 * service is the NEW half of the backlog line: "a periodic audit report
 * scanning for any possible self-approval cases."
 *
 * Given the guards in Part A.5 are already structural, a clean run finding
 * zero violations is the EXPECTED, not the notable, outcome — this exists as
 * independent verification (an auditor should not have to trust "the code
 * has a guard," they should be able to see "we scanned, and found none")
 * and as the one compensating control for the one pair the guards can't
 * fully cover on their own (`PolicyChecking.checkedByUserId` vs the PARENT
 * `Policy.issuedByUserId` — a cross-table pair no single-table DB `CHECK`
 * can express; see `internal-controls.config.ts`'s header comment).
 *
 * `runSelfApprovalAudit` always writes a best-effort `READ` audit row
 * (counts only, never a user id) — the same "prove someone looked"
 * precedent as `SlaDashboardService`. If it finds ANY violation, that is a
 * critical, actionable finding: logged at ERROR level AND persisted as one
 * `InternalControlsViolation` `CREATE` row per violation (entity/field/user
 * ids — no new model, `AuditLogEntry`'s own polymorphism is the record,
 * same choice #48's `TransactionMonitoringAlert` record-keeping made).
 */
@Injectable()
export class InternalControlsService {
  private readonly logger = new Logger(InternalControlsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async runSelfApprovalAudit(
    actorUserId: string,
  ): Promise<InternalControlsAuditReport> {
    // 16 independent read-only queries — run concurrently rather than one
    // round trip at a time. Each table is scanned in full (no `where`; see
    // the class doc comment on why), so 16 sequential awaits against a
    // long-lived, cumulative dev/test database was measured to add up to a
    // genuinely slow report, not just a slow test.
    const pairResults = await Promise.all([
      ...MAKER_CHECKER_REGISTRY.map((pair) => this.scanPair(pair)),
      this.scanPolicyCheckingIssuerPair(),
    ]);

    const report = buildInternalControlsReport(pairResults, new Date());
    await this.recordOutcome(actorUserId, report);
    return report;
  }

  private async scanPair(
    pair: MakerCheckerPair,
  ): Promise<MakerCheckerPairResult> {
    const client = this.prisma.client as unknown as Record<
      string,
      GenericFindManyDelegate
    >;
    const rows = await client[pair.modelProperty].findMany({
      select: { id: true, [pair.makerField]: true, [pair.checkerField]: true },
      take: INTERNAL_CONTROLS_SCAN_LIMIT,
    });
    if (rows.length >= INTERNAL_CONTROLS_SCAN_LIMIT) {
      this.logger.warn(
        `Internal controls audit: ${pair.entityType} (${pair.pairLabel}) truncated at ${INTERNAL_CONTROLS_SCAN_LIMIT} rows — this pair's result is incomplete.`,
      );
    }
    return {
      entityType: pair.entityType,
      pairLabel: pair.pairLabel,
      rowsChecked: rows.length,
      violations: classifyPairRows(pair, rows),
      dbCheckConstraint: pair.dbCheckConstraint,
      dormant: pair.dormant,
      truncated: rows.length >= INTERNAL_CONTROLS_SCAN_LIMIT,
    };
  }

  private async scanPolicyCheckingIssuerPair(): Promise<MakerCheckerPairResult> {
    const crossTableRows: PolicyCheckingCrossTableRow[] =
      await this.prisma.client.policyChecking.findMany({
        select: {
          id: true,
          checkedByUserId: true,
          policy: { select: { issuedByUserId: true } },
        },
        take: INTERNAL_CONTROLS_SCAN_LIMIT,
      });
    if (crossTableRows.length >= INTERNAL_CONTROLS_SCAN_LIMIT) {
      this.logger.warn(
        `Internal controls audit: ${POLICY_CHECKING_ISSUER_PAIR.entityType} (${POLICY_CHECKING_ISSUER_PAIR.pairLabel}) truncated at ${INTERNAL_CONTROLS_SCAN_LIMIT} rows — this pair's result is incomplete.`,
      );
    }
    return {
      entityType: POLICY_CHECKING_ISSUER_PAIR.entityType,
      pairLabel: POLICY_CHECKING_ISSUER_PAIR.pairLabel,
      rowsChecked: crossTableRows.length,
      violations: classifyCrossTableRows(crossTableRows),
      dbCheckConstraint: POLICY_CHECKING_ISSUER_PAIR.dbCheckConstraint,
      dormant: POLICY_CHECKING_ISSUER_PAIR.dormant,
      truncated: crossTableRows.length >= INTERNAL_CONTROLS_SCAN_LIMIT,
    };
  }

  /** Delegates to the same scan the on-demand endpoint runs — the #49/#51
   * "service owns the sweep, scheduler + endpoint both call it" shape. */
  async runScheduledAudit(
    systemUserId: string,
  ): Promise<InternalControlsAuditReport> {
    return this.runSelfApprovalAudit(systemUserId);
  }

  private async recordOutcome(
    actorUserId: string,
    report: InternalControlsAuditReport,
  ): Promise<void> {
    try {
      await this.audit.record({
        userId: actorUserId,
        action: 'READ',
        entityType: 'InternalControlsAuditReport',
        entityId: 'self-approval-audit',
        afterValue: {
          generatedAt: report.generatedAt,
          pairsScanned: report.pairsScanned,
          totalRowsChecked: report.totalRowsChecked,
          violationCount: report.violations.length,
        },
      });
    } catch (err) {
      this.logger.error(
        `Internal controls audit READ row did not write: ${(err as Error).message}`,
      );
    }

    if (report.violations.length === 0) {
      this.logger.log(
        `Internal controls self-approval audit: ${report.pairsScanned} pairs, ${report.totalRowsChecked} rows checked, 0 violations.`,
      );
      return;
    }

    // Not "some rows were odd" — every entry here means a guard that should
    // be structurally impossible to bypass was bypassed. Loud on purpose.
    this.logger.error(
      `Internal controls self-approval audit found ${report.violations.length} SELF-APPROVAL VIOLATION(S) — see InternalControlsViolation audit rows for entity/user detail.`,
    );
    try {
      await this.audit.recordMany(
        report.violations.map((v) => ({
          userId: actorUserId,
          action: 'CREATE',
          entityType: 'InternalControlsViolation',
          entityId: `${v.entityType}:${v.entityId}`,
          afterValue: {
            entityType: v.entityType,
            pairLabel: v.pairLabel,
            entityId: v.entityId,
            makerField: v.makerField,
            checkerField: v.checkerField,
            userId: v.userId,
            dbCheckConstraint: v.dbCheckConstraint,
          } satisfies Prisma.InputJsonObject,
        })),
      );
    } catch (err) {
      this.logger.error(
        `Internal controls VIOLATION audit rows did not write: ${(err as Error).message}`,
      );
    }
  }
}
