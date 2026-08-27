import { Injectable, NotFoundException } from '@nestjs/common';
import type { RiskLevel, ScreeningResult } from '@ibms/db';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { matchesSampleWatchlist } from './sample-watchlist';

const SCREENING_TYPES = ['SANCTIONS', 'PEP', 'AML'] as const;

export interface ScreeningRunResult {
  results: ScreeningResult[];
  riskLevel: RiskLevel;
  isEdd: boolean;
  /** True when THIS run produced at least one HIT — distinct from `isEdd`
   * (the record's flag, which only ever escalates and is never cleared by a
   * later CLEAR re-scan). Used by the recurring batch for its hit counter. */
  newHit: boolean;
}

/** Process 3.1/47/49 — sanctions/PEP/AML screening. Checks the Customer's
 * `legalName` and every UBO's `fullName` on the same KYCRecord's Customer
 * against `sample-watchlist.ts` (no real screening data provider exists —
 * see that file's header). All three `ScreeningType`s are checked against
 * the same fixture list here (a real integration would call three distinct
 * lists/providers); this is a deliberate simplification of the simulation,
 * not a claim that sanctions/PEP/AML are the same list. */
@Injectable()
export class ScreeningService {
  constructor(
    private readonly kycRecords: KycRecordRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
  ) {}

  async run(
    kycRecordId: string,
    actorUserId: string,
  ): Promise<ScreeningRunResult> {
    const kyc = await this.kycRecords.findById(kycRecordId);
    if (!kyc) throw new NotFoundException('KYCRecord not found');
    const customer = await this.customers.findById(kyc.customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const ubos = await this.customers.findUbosByCustomerId(kyc.customerId);

    const subjectNames = [customer.legalName, ...ubos.map((u) => u.fullName)];

    const results: ScreeningResult[] = [];
    const now = new Date();

    // subjectNames is fixed for this run, so the match result is identical
    // for every ScreeningType — compute it once rather than re-scanning the
    // same names 3 times for the same answer.
    const hit = subjectNames
      .map((name) => matchesSampleWatchlist(name))
      .find((match) => match !== null);
    const anyHit = hit !== undefined;

    for (const screeningType of SCREENING_TYPES) {
      const result = await this.kycRecords.createScreeningResult({
        kycRecordId,
        screeningType,
        result: hit ? 'HIT' : 'CLEAR',
        listSource: hit?.listSource,
        escalatedToComplianceAt: hit ? now : undefined,
      });
      results.push(result);

      await this.audit.record({
        userId: actorUserId,
        action: 'CREATE',
        entityType: 'ScreeningResult',
        entityId: result.id,
        afterValue: {
          kycRecordId,
          screeningType,
          result: result.result,
          // listSource identifies which fixture/provider list matched —
          // never the matched subject's own PII (sensitive-data-handling.md
          // "log identifiers instead").
          listSource: result.listSource,
        },
      });
    }

    // A re-screen (KycService.rerunScreening, or the monthly
    // ScreeningBatchScheduler) must never silently DOWNGRADE a
    // classification: a CLEAR result on a later scan does not undo whatever
    // drove a prior HIT-based escalation — that call is a deliberate
    // Compliance decision, not an automatic side effect. So the level and
    // the isEdd flag only ever escalate here (a retained HIGH is a no-op,
    // handled below by not re-writing the row at all).
    const existingRating =
      await this.kycRecords.findRiskRatingByKycRecordId(kycRecordId);
    const riskLevel: RiskLevel =
      anyHit || existingRating?.level === 'HIGH' ? 'HIGH' : 'STANDARD';
    const ratingReason = anyHit
      ? 'Automatic: at least one sanctions/PEP/AML screening result was a HIT'
      : 'Automatic: all sanctions/PEP/AML screening results were CLEAR';

    // Only write the RiskRating when the classification actually changes
    // (first assessment, or an escalation) — and audit every such write.
    // `upsertRiskRating`'s update branch bumps `ratedAt` and rewrites
    // `reason` unconditionally, so calling it on a re-screen that keeps the
    // same level would silently mutate the row (a reviewer reads `ratedAt`
    // as "when this rating was last assessed") with nothing in the audit
    // trail. The per-run "we screened again and it was CLEAR" evidence is
    // the ScreeningResult rows above; RiskRating is the classification,
    // which only moves on escalation.
    if (!existingRating || existingRating.level !== riskLevel) {
      const rating = await this.kycRecords.upsertRiskRating({
        kycRecordId,
        level: riskLevel,
        reason: ratingReason,
      });
      await this.audit.record(
        existingRating
          ? {
              userId: actorUserId,
              action: 'UPDATE',
              entityType: 'RiskRating',
              entityId: rating.id,
              beforeValue: { level: existingRating.level },
              afterValue: { level: riskLevel, reason: ratingReason },
            }
          : {
              userId: actorUserId,
              action: 'CREATE',
              entityType: 'RiskRating',
              entityId: rating.id,
              afterValue: { kycRecordId, level: riskLevel },
            },
      );
    }

    // isEdd only ever goes false -> true (on a HIT); a subsequent CLEAR
    // re-scan never clears it.
    const currentIsEdd = kyc.isEdd ?? false;
    const nextIsEdd = currentIsEdd || anyHit;
    if (nextIsEdd !== currentIsEdd) {
      await this.kycRecords.update(kycRecordId, { isEdd: nextIsEdd });
      await this.audit.record({
        userId: actorUserId,
        action: 'UPDATE',
        entityType: 'KYCRecord',
        entityId: kycRecordId,
        beforeValue: { isEdd: currentIsEdd },
        afterValue: { isEdd: nextIsEdd },
      });
    }

    return { results, riskLevel, isEdd: nextIsEdd, newHit: anyHit };
  }
}
